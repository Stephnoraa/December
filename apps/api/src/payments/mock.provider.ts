import { HttpStatus } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ErrorCode } from '@app/shared';
import { AppError } from '../common/errors';
import {
  PaymentProvider,
  type Bank,
  type CreateSubaccountInput,
  type InitializeInput,
  type InitializeResult,
  type VerifyResult,
} from './payment-provider';
import { paystackSignature, signatureMatches } from './signature';

interface MockTx {
  reference: string;
  amountKobo: number;
  email: string;
  status: 'pending' | 'success' | 'failed' | 'abandoned';
  channel: string | null;
  paidAt: Date | null;
  metadata: InitializeInput['metadata'];
  callbackUrl: string;
}

/**
 * In-memory stand-in for Paystack (tests and local dev without keys). Checkout happens on the
 * customer app's /mock-pay/:reference page, which completes the payment through a dev-only
 * API route that sends a correctly signed webhook, exactly like Paystack would.
 */
export class MockPaymentProvider extends PaymentProvider {
  readonly name = 'mock' as const;
  readonly transactions = new Map<string, MockTx>();

  constructor(
    private readonly secret: string,
    private readonly checkoutBaseUrl: string,
  ) {
    super();
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    this.transactions.set(input.reference, {
      reference: input.reference,
      amountKobo: input.amountKobo,
      email: input.email,
      status: 'pending',
      channel: null,
      paidAt: null,
      metadata: input.metadata,
      callbackUrl: input.callbackUrl,
    });
    return {
      authorizationUrl: `${this.checkoutBaseUrl.replace(/\/$/, '')}/mock-pay/${input.reference}`,
      accessCode: null,
    };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const tx = this.transactions.get(reference);
    if (!tx)
      return {
        status: 'abandoned',
        amountKobo: 0,
        currency: 'NGN',
        channel: null,
        paidAt: null,
        raw: { reference },
      };
    return {
      status: tx.status,
      amountKobo: tx.amountKobo,
      currency: 'NGN',
      channel: tx.channel,
      paidAt: tx.paidAt,
      raw: { ...tx },
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return signatureMatches(rawBody, signature, [this.secret]);
  }

  /** Marks a mock transaction paid/failed and returns the signed webhook Paystack would send. */
  complete(
    reference: string,
    outcome: 'success' | 'failed',
    channel = 'card',
  ): { rawBody: Buffer; signature: string } {
    const tx = this.transactions.get(reference);
    if (!tx)
      throw new AppError(ErrorCode.NOT_FOUND, 'Unknown mock transaction', HttpStatus.NOT_FOUND);
    tx.status = outcome;
    tx.channel = channel;
    tx.paidAt = outcome === 'success' ? new Date() : null;
    const event = {
      event: outcome === 'success' ? 'charge.success' : 'charge.failed',
      data: {
        id: Number.parseInt(randomBytes(4).toString('hex'), 16),
        status: tx.status,
        reference,
        amount: tx.amountKobo,
        currency: 'NGN',
        channel,
        paid_at: tx.paidAt?.toISOString() ?? null,
        customer: { email: tx.email },
        metadata: tx.metadata,
      },
    };
    const rawBody = Buffer.from(JSON.stringify(event));
    return { rawBody, signature: paystackSignature(rawBody, this.secret) };
  }

  async listBanks(): Promise<Bank[]> {
    return [
      { name: 'Access Bank', code: '044' },
      { name: 'First Bank of Nigeria', code: '011' },
      { name: 'Guaranty Trust Bank', code: '058' },
      { name: 'Kuda Bank', code: '50211' },
      { name: 'Moniepoint MFB', code: '50515' },
      { name: 'OPay Digital Services', code: '999992' },
      { name: 'United Bank For Africa', code: '033' },
      { name: 'Zenith Bank', code: '057' },
    ];
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<{ accountName: string }> {
    if (accountNumber === '0000000001') {
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        'Could not resolve account name. Check parameters or try again.',
      );
    }
    return { accountName: `MOCK ACCOUNT ${bankCode}-${accountNumber.slice(-4)}` };
  }

  async createSubaccount(_input: CreateSubaccountInput): Promise<{ subaccountCode: string }> {
    return { subaccountCode: `ACCT_mock_${randomBytes(6).toString('hex')}` };
  }
}
