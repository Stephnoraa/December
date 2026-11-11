import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx?.close();
});

const signup = (email: string, venueName = 'Idem Lounge') => ({
  ownerName: 'Idem Owner',
  email,
  password: 'super-secret-1',
  pin: '4321',
  venueName,
});

describe('Idempotency-Key', () => {
  it('replays the original response for a duplicate request and does not run it twice', async () => {
    const key = 'idem-key-signup-0001';
    const first = await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', key)
      .send(signup('idem@example.com'))
      .expect(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const second = await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', key)
      .send(signup('idem@example.com'))
      .expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await ctx.raw.venue.count({ where: { name: 'Idem Lounge' } })).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const key = 'idem-key-signup-0002';
    await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', key)
      .send(signup('idem2@example.com', 'Two'))
      .expect(201);
    const res = await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', key)
      .send(signup('idem3@example.com', 'Three'))
      .expect(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await ctx.raw.venue.count({ where: { name: 'Three' } })).toBe(0);
  });

  it('answers 409 while the original request is still in progress', async () => {
    const key = 'idem-key-signup-0003';
    await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', key)
      .send(signup('idem4@example.com', 'Four'))
      .expect(201);
    const rec = await ctx.raw.idempotencyRecord.findFirstOrThrow({ where: { key } });
    await ctx.raw.idempotencyRecord.update({
      where: { id: rec.id },
      data: { status: 'IN_PROGRESS' },
    });
    const res = await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', key)
      .send(signup('idem4@example.com', 'Four'))
      .expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
  });

  it('releases the key when the request fails, so a corrected retry can succeed', async () => {
    const key = 'idem-key-signup-0004';
    const bad = { ...signup('idem5@example.com', 'Five'), pin: '12' };
    await ctx.http().post('/v1/auth/signup').set('Idempotency-Key', key).send(bad).expect(400);
    expect(await ctx.raw.idempotencyRecord.count({ where: { key } })).toBe(0);
    // Same key, same (still invalid) body is processed again rather than replayed.
    await ctx.http().post('/v1/auth/signup').set('Idempotency-Key', key).send(bad).expect(400);
  });

  it('expires keys after 24 hours', async () => {
    const key = 'idem-key-signup-0005';
    await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', key)
      .send(signup('idem6@example.com', 'Six'))
      .expect(201);
    await ctx.raw.idempotencyRecord.updateMany({
      where: { key },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    // Expired: the request runs again (and fails because the email now exists).
    const res = await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', key)
      .send(signup('idem6@example.com', 'Six'))
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates the key format', async () => {
    const res = await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', 'bad key!')
      .send(signup('x@example.com'))
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('ignores the header on GET requests', async () => {
    await ctx.http().get('/healthz').set('Idempotency-Key', 'idem-key-get-000001').expect(200);
    expect(await ctx.raw.idempotencyRecord.count({ where: { key: 'idem-key-get-000001' } })).toBe(
      0,
    );
  });
});
