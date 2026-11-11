import { createHmac, timingSafeEqual } from 'node:crypto';

/** Paystack webhook signature: hex HMAC-SHA512 of the raw request body, keyed with the secret. */
export function paystackSignature(rawBody: Buffer, secret: string): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

export function signatureMatches(
  rawBody: Buffer,
  signature: string | undefined,
  secrets: (string | undefined)[],
): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const given = Buffer.from(signature.toLowerCase(), 'hex');
  return secrets.some((secret) => {
    if (!secret) return false;
    const expected = Buffer.from(paystackSignature(rawBody, secret), 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}
