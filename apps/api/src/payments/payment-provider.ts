/**
 * Payment provider abstraction. The real implementation is Paystack; a mock is used in tests
 * and in local development when no Paystack key is configured.
 */
export interface InitializeInput {
  reference: string;
  amountKobo: number;
  email: string;
  subaccountCode: string;
  callbackUrl: string;
  metadata: Record<string, string | number | null>;
}

export interface InitializeResult {
  authorizationUrl: string;
  accessCode: string | null;
}

/** Provider transaction status ('success' is the only one that means money was received). */
export type ProviderTxStatus =
  'success' | 'failed' | 'abandoned' | 'pending' | 'reversed' | 'unknown';

export interface VerifyResult {
  status: ProviderTxStatus;
  amountKobo: number;
  currency: string;
  channel: string | null;
  paidAt: Date | null;
  raw: unknown;
}

export interface Bank {
  name: string;
  code: string;
}

export interface CreateSubaccountInput {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  percentageCharge: number;
  description: string;
}

export abstract class PaymentProvider {
  abstract readonly name: 'paystack' | 'mock';
  abstract initialize(input: InitializeInput): Promise<InitializeResult>;
  abstract verify(reference: string): Promise<VerifyResult>;
  /** Checks the webhook signature over the exact raw request body. */
  abstract verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  abstract listBanks(): Promise<Bank[]>;
  abstract resolveAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ accountName: string }>;
  abstract createSubaccount(input: CreateSubaccountInput): Promise<{ subaccountCode: string }>;
}
