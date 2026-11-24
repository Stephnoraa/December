import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, loginOwner, type Agent, type TestContext } from './helpers';

let ctx: TestContext;
let owner: Agent;

beforeAll(async () => {
  ctx = await createTestContext();
  owner = await loginOwner(ctx);
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

const stationCount = (name: string) =>
  ctx.raw.station.count({ where: { venueId: ctx.venueId, name } });

describe('Idempotency-Key', () => {
  it('replays the original response for a duplicate request and does not run it twice', async () => {
    const key = 'idem-key-station-0001';
    const first = await owner
      .post('/v1/admin/stations')
      .set('Idempotency-Key', key)
      .send({ name: 'Idem One' })
      .expect(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const second = await owner
      .post('/v1/admin/stations')
      .set('Idempotency-Key', key)
      .send({ name: 'Idem One' })
      .expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await stationCount('Idem One')).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const key = 'idem-key-station-0002';
    await owner
      .post('/v1/admin/stations')
      .set('Idempotency-Key', key)
      .send({ name: 'Idem Two' })
      .expect(201);
    const res = await owner
      .post('/v1/admin/stations')
      .set('Idempotency-Key', key)
      .send({ name: 'Idem Three' })
      .expect(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await stationCount('Idem Three')).toBe(0);
  });

  it('answers 409 while the original request is still in progress', async () => {
    const key = 'idem-key-station-0003';
    await owner
      .post('/v1/admin/stations')
      .set('Idempotency-Key', key)
      .send({ name: 'Idem Four' })
      .expect(201);
    const rec = await ctx.raw.idempotencyRecord.findFirstOrThrow({ where: { key } });
    await ctx.raw.idempotencyRecord.update({
      where: { id: rec.id },
      data: { status: 'IN_PROGRESS' },
    });
    const res = await owner
      .post('/v1/admin/stations')
      .set('Idempotency-Key', key)
      .send({ name: 'Idem Four' })
      .expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
  });

  it('releases the key when the request fails, so a corrected retry can succeed', async () => {
    const key = 'idem-key-station-0004';
    const bad = { name: '' };
    await owner.post('/v1/admin/stations').set('Idempotency-Key', key).send(bad).expect(400);
    expect(await ctx.raw.idempotencyRecord.count({ where: { key } })).toBe(0);
    // Same key, same (still invalid) body is processed again rather than replayed.
    await owner.post('/v1/admin/stations').set('Idempotency-Key', key).send(bad).expect(400);
    await owner
      .post('/v1/admin/stations')
      .set('Idempotency-Key', key)
      .send({ name: 'Idem Five' })
      .expect(201);
  });

  it('expires keys after 24 hours', async () => {
    const key = 'idem-key-station-0005';
    await owner
      .post('/v1/admin/stations')
      .set('Idempotency-Key', key)
      .send({ name: 'Idem Six' })
      .expect(201);
    await ctx.raw.idempotencyRecord.updateMany({
      where: { key },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    // Expired: the request runs again (and fails because the station name is now taken).
    const res = await owner
      .post('/v1/admin/stations')
      .set('Idempotency-Key', key)
      .send({ name: 'Idem Six' })
      .expect(409);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await stationCount('Idem Six')).toBe(1);
  });

  it('validates the key format', async () => {
    const res = await owner
      .post('/v1/admin/stations')
      .set('Idempotency-Key', 'bad key!')
      .send({ name: 'Idem Seven' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await stationCount('Idem Seven')).toBe(0);
  });

  it('never stores or replays responses that carry credentials', async () => {
    const key = 'idem-key-signup-0001';
    const first = await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', key)
      .send(signup('idem@example.com'))
      .expect(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(await ctx.raw.idempotencyRecord.count({ where: { key } })).toBe(0);
    // A retry runs again instead of replaying the tokens, and the unique email stops a duplicate.
    const second = await ctx
      .http()
      .post('/v1/auth/signup')
      .set('Idempotency-Key', key)
      .send(signup('idem@example.com'))
      .expect(409);
    expect(second.body.error.code).toBe('EMAIL_TAKEN');
    expect(await ctx.raw.venue.count({ where: { name: 'Idem Lounge' } })).toBe(1);
  });

  it('ignores the header on GET requests', async () => {
    await ctx.http().get('/healthz').set('Idempotency-Key', 'idem-key-get-000001').expect(200);
    expect(await ctx.raw.idempotencyRecord.count({ where: { key: 'idem-key-get-000001' } })).toBe(
      0,
    );
  });
});
