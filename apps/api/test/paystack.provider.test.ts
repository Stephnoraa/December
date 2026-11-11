import { describe, expect, it, vi } from 'vitest';
import { PaystackProvider } from '../src/payments/paystack.provider';
import { paystackSignature } from '../src/payments/signature';

const env = {
  PAYSTACK_SECRET_KEY: 'sk_test_abc',
  PAYSTACK_BASE_URL: 'https://api.paystack.co',
  PAYSTACK_WEBHOOK_SECRET: undefined,
  PAYSTACK_FEE_BEARER: 'subaccount' as const,
};

function fakeFetch(data: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ status: status < 400, message: 'ok', data }), { status }),
  );
}

describe('PaystackProvider', () => {
  it('initializes a transaction with kobo amount, sub-account, bearer and channels', async () => {
    const fetchImpl = fakeFetch({
      authorization_url: 'https://checkout.paystack.com/x',
      access_code: 'x',
      reference: 'qr-1',
    });
    const p = new PaystackProvider(env, fetchImpl as unknown as typeof fetch);
    const res = await p.initialize({
      reference: 'qr-1',
      amountKobo: 350_000,
      email: 'a@b.co',
      subaccountCode: 'ACCT_x',
      callbackUrl: 'https://order.example.ng/t/x/y?payment=qr-1',
      metadata: { venueId: 'v' },
    });
    expect(res.authorizationUrl).toBe('https://checkout.paystack.com/x');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_abc');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'a@b.co',
      amount: 350_000,
      currency: 'NGN',
      reference: 'qr-1',
      callback_url: 'https://order.example.ng/t/x/y?payment=qr-1',
      channels: ['card', 'bank_transfer', 'ussd'],
      subaccount: 'ACCT_x',
      bearer: 'subaccount',
      metadata: { venueId: 'v' },
    });
  });

  it('maps verify responses', async () => {
    const p = new PaystackProvider(
      env,
      fakeFetch({
        status: 'success',
        amount: 500,
        currency: 'NGN',
        channel: 'bank_transfer',
        paid_at: '2026-12-20T20:00:00.000Z',
        reference: 'r',
      }) as unknown as typeof fetch,
    );
    const v = await p.verify('r');
    expect(v).toMatchObject({
      status: 'success',
      amountKobo: 500,
      channel: 'bank_transfer',
      currency: 'NGN',
    });
    const q = new PaystackProvider(
      env,
      fakeFetch({
        status: 'ongoing',
        amount: 1,
        currency: 'NGN',
        channel: null,
        paid_at: null,
        reference: 'r',
      }) as unknown as typeof fetch,
    );
    expect((await q.verify('r')).status).toBe('pending');
  });

  it('turns Paystack errors into PAYMENT_PROVIDER_ERROR', async () => {
    const p = new PaystackProvider(env, fakeFetch(null, 400) as unknown as typeof fetch);
    await expect(p.resolveAccount('0123456789', '058')).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_ERROR',
    });
  });

  it('verifies webhook signatures as HMAC-SHA512 of the raw body', () => {
    const p = new PaystackProvider(
      { ...env, PAYSTACK_WEBHOOK_SECRET: 'whsec_rotated' },
      fakeFetch(null) as unknown as typeof fetch,
    );
    const body = Buffer.from('{"event":"charge.success","data":{"reference":"r"}}');
    expect(p.verifyWebhookSignature(body, paystackSignature(body, 'sk_test_abc'))).toBe(true);
    expect(p.verifyWebhookSignature(body, paystackSignature(body, 'whsec_rotated'))).toBe(true);
    expect(p.verifyWebhookSignature(body, paystackSignature(body, 'other'))).toBe(false);
    expect(
      p.verifyWebhookSignature(
        Buffer.from(body.toString() + ' '),
        paystackSignature(body, 'sk_test_abc'),
      ),
    ).toBe(false);
    expect(p.verifyWebhookSignature(body, undefined)).toBe(false);
    expect(p.verifyWebhookSignature(body, 'abc')).toBe(false);
  });
});
