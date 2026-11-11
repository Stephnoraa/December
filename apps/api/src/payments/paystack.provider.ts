import { HttpStatus, Logger } from '@nestjs/common';
import { ErrorCode } from '@app/shared';
import { AppError } from '../common/errors';
import type { Env } from '../config/env';
import {
  PaymentProvider,
  type Bank,
  type CreateSubaccountInput,
  type InitializeInput,
  type InitializeResult,
  type ProviderTxStatus,
  type VerifyResult,
} from './payment-provider';
import { signatureMatches } from './signature';

/**
 * Paystack integration. Endpoints and fields checked against Paystack's official OpenAPI spec
 * (https://github.com/PaystackOSS/openapi, dist/paystack.yaml) and docs:
 *  - Initialize: POST /transaction/initialize  https://paystack.com/docs/api/transaction/#initialize
 *  - Verify:     GET  /transaction/verify/:reference  https://paystack.com/docs/api/transaction/#verify
 *  - Webhooks:   x-paystack-signature = HMAC-SHA512(raw body, secret key)  https://paystack.com/docs/payments/webhooks/
 *  - Sub-accounts: POST /subaccount  https://paystack.com/docs/api/subaccount/#create
 *  - Banks: GET /bank?country=nigeria; resolve: GET /bank/resolve  https://paystack.com/docs/api/miscellaneous/#bank
 *    https://paystack.com/docs/api/verification/#resolve-account
 * Amounts are integers in kobo (the currency's smallest unit).
 */
export class PaystackProvider extends PaymentProvider {
  readonly name = 'paystack' as const;
  private readonly logger = new Logger('Paystack');
  private bankCache: { at: number; banks: Bank[] } | null = null;

  constructor(
    private readonly env: Pick<
      Env,
      | 'PAYSTACK_SECRET_KEY'
      | 'PAYSTACK_BASE_URL'
      | 'PAYSTACK_WEBHOOK_SECRET'
      | 'PAYSTACK_FEE_BEARER'
    >,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.env.PAYSTACK_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.env.PAYSTACK_SECRET_KEY}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger.warn(`Paystack ${method} ${path} failed: ${String(err)}`);
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        'Payment service is not reachable. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const json = (await res.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: T;
    } | null;
    if (!res.ok || !json?.status) {
      this.logger.warn(
        `Paystack ${method} ${path} -> ${res.status}: ${json?.message ?? 'no body'}`,
      );
      const status = res.status >= 500 ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST;
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        json?.message ?? 'Payment service error',
        status,
      );
    }
    return json.data as T;
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    const data = await this.call<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>('POST', '/transaction/initialize', {
      email: input.email,
      amount: input.amountKobo,
      currency: 'NGN',
      reference: input.reference,
      callback_url: input.callbackUrl,
      channels: ['card', 'bank_transfer', 'ussd'],
      subaccount: input.subaccountCode,
      bearer: this.env.PAYSTACK_FEE_BEARER,
      metadata: input.metadata,
    });
    return { authorizationUrl: data.authorization_url, accessCode: data.access_code };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const data = await this.call<{
      status: string;
      amount: number;
      currency: string;
      channel: string | null;
      paid_at: string | null;
      reference: string;
    }>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    const known: ProviderTxStatus[] = ['success', 'failed', 'abandoned', 'pending', 'reversed'];
    return {
      status: (known as string[]).includes(data.status)
        ? (data.status as ProviderTxStatus)
        : data.status === 'ongoing' || data.status === 'processing' || data.status === 'queued'
          ? 'pending'
          : 'unknown',
      amountKobo: data.amount,
      currency: data.currency,
      channel: data.channel,
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
      raw: data,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return signatureMatches(rawBody, signature, [
      this.env.PAYSTACK_SECRET_KEY,
      this.env.PAYSTACK_WEBHOOK_SECRET,
    ]);
  }

  async listBanks(): Promise<Bank[]> {
    if (this.bankCache && Date.now() - this.bankCache.at < 6 * 3600_000)
      return this.bankCache.banks;
    const data = await this.call<
      { name: string; code: string; active: boolean; currency: string }[]
    >('GET', '/bank?country=nigeria&currency=NGN&perPage=100');
    const banks = data
      .filter((b) => b.active !== false)
      .map((b) => ({ name: b.name, code: b.code }));
    this.bankCache = { at: Date.now(), banks };
    return banks;
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<{ accountName: string }> {
    const data = await this.call<{ account_number: string; account_name: string }>(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
    return { accountName: data.account_name };
  }

  async createSubaccount(input: CreateSubaccountInput): Promise<{ subaccountCode: string }> {
    const data = await this.call<{ subaccount_code: string }>('POST', '/subaccount', {
      business_name: input.businessName,
      settlement_bank: input.bankCode,
      account_number: input.accountNumber,
      percentage_charge: input.percentageCharge,
      description: input.description,
    });
    return { subaccountCode: data.subaccount_code };
  }
}
