import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestContext,
  DEMO,
  loginOwner,
  pinAgent,
  staffByRole,
  type TestContext,
} from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx?.close();
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    await ctx.http().get('/healthz').expect(200, { status: 'ok' });
    const res = await ctx.http().get('/readyz').expect(200);
    expect(res.body.checks).toEqual({ database: 'ok', redis: 'ok' });
  });
});

describe('owner signup and password login', () => {
  it('signs up an owner, creates the venue and returns a token pair', async () => {
    const agent = ctx.agent();
    const res = await agent
      .post('/v1/auth/signup')
      .send({
        ownerName: 'Bola Ade',
        email: 'Bola@Example.com',
        password: 'super-secret-1',
        pin: '5678',
        venueName: 'Bola Lounge',
      })
      .expect(201);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.stringMatching(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/),
      expiresIn: 900,
    });
    // Only a hash of the refresh secret is stored.
    const [sessionId, secret] = (res.body.refreshToken as string).split('.');
    const session = await ctx.raw.staffSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.refreshTokenHash).not.toContain(secret);
    const me = await agent.get('/v1/auth/me').expect(200);
    expect(me.body.staff.role).toBe('OWNER');
    expect(me.body.venue.name).toBe('Bola Lounge');
    expect(me.body.venue.slug).toBe('bola-lounge');
    expect(me.body.permissions).toContain('venue.payout');
    const owner = await ctx.raw.staffMember.findUniqueOrThrow({
      where: { email: 'bola@example.com' },
    });
    expect(owner.passwordHash).toMatch(/^\$argon2/);
    expect(owner.pinHash).toMatch(/^\$argon2/);
    const audit = await ctx.raw.auditEvent.findFirst({
      where: { venueId: me.body.venue.id, action: 'VENUE_CREATED' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects a duplicate email and invalid input', async () => {
    const dup = await ctx
      .http()
      .post('/v1/auth/signup')
      .send({
        ownerName: 'X Y',
        email: DEMO.owner.email,
        password: 'super-secret-1',
        pin: '1234',
        venueName: 'Another',
      })
      .expect(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
    const bad = await ctx.http().post('/v1/auth/signup').send({ email: 'nope' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('logs in with email + password and logs out', async () => {
    const agent = ctx.agent();
    const wrong = await agent
      .post('/v1/auth/login')
      .send({ email: DEMO.owner.email, password: 'wrong-password' })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    await agent
      .post('/v1/auth/login')
      .send({ email: DEMO.owner.email, password: DEMO.owner.password })
      .expect(200);
    await agent.get('/v1/auth/me').expect(200);
    await agent.post('/v1/auth/logout').expect(200);
    await agent.get('/v1/auth/me').expect(401);
  });

  it('requires authentication', async () => {
    const res = await ctx.http().get('/v1/auth/me').expect(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in' } });
  });
});

describe('device PIN login', () => {
  it('refuses PIN login on a device that is not enabled', async () => {
    const staff = await staffByRole(ctx, 'WAITER');
    const res = await ctx
      .http()
      .post('/v1/auth/pin-login')
      .send({ staffId: staff.id, pin: DEMO.waiter.pin })
      .expect(401);
    expect(res.body.error.code).toBe('DEVICE_NOT_REGISTERED');
  });

  it('lets a manager enable a device, then staff sign in with their PIN', async () => {
    const agent = await loginOwner(ctx);
    await agent.post('/v1/auth/device').send({ name: 'Bar tablet' }).expect(201);
    const info = await agent.get('/v1/auth/device').expect(200);
    expect(info.body.venue.name).toBe('Demo Lounge');
    expect(info.body.staff.map((s: { role: string }) => s.role).sort()).toEqual([
      'MANAGER',
      'OWNER',
      'STATION',
      'WAITER',
    ]);
    const waiter = await staffByRole(ctx, 'WAITER');
    await agent
      .post('/v1/auth/pin-login')
      .send({ staffId: waiter.id, pin: DEMO.waiter.pin })
      .expect(200);
    const me = await agent.get('/v1/auth/me').expect(200);
    expect(me.body.staff.role).toBe('WAITER');
    expect(me.body.deviceId).toBeTruthy();
    expect(me.body.permissions).not.toContain('menu.manage');
  });

  it('does not let waiters enable devices', async () => {
    const agent = await loginOwner(ctx);
    await agent.post('/v1/auth/device').send({ name: 'Tablet' }).expect(201);
    const waiter = await staffByRole(ctx, 'WAITER');
    await agent
      .post('/v1/auth/pin-login')
      .send({ staffId: waiter.id, pin: DEMO.waiter.pin })
      .expect(200);
    const res = await agent.post('/v1/auth/device').send({ name: 'Another' }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('locks the PIN after 5 wrong attempts and audits the lockout', async () => {
    const agent = await loginOwner(ctx);
    await agent.post('/v1/auth/device').send({ name: 'Kitchen tablet' }).expect(201);
    const station = await staffByRole(ctx, 'STATION');
    for (let i = 0; i < 4; i++) {
      const res = await agent
        .post('/v1/auth/pin-login')
        .send({ staffId: station.id, pin: '0000' })
        .expect(401);
      expect(res.body.error.details.attemptsLeft).toBe(4 - i);
    }
    const locked = await agent
      .post('/v1/auth/pin-login')
      .send({ staffId: station.id, pin: '0000' })
      .expect(429);
    expect(locked.body.error.code).toBe('PIN_LOCKED');
    // Even the right PIN is refused while locked.
    const still = await agent
      .post('/v1/auth/pin-login')
      .send({ staffId: station.id, pin: DEMO.station.pin })
      .expect(429);
    expect(still.body.error.code).toBe('PIN_LOCKED');
    const audit = await ctx.raw.auditEvent.findFirst({
      where: { action: 'PIN_LOCKOUT', entityId: station.id },
    });
    expect(audit).not.toBeNull();
    const row = await ctx.raw.staffMember.findUniqueOrThrow({ where: { id: station.id } });
    expect(row.pinLockedUntil!.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    await ctx.raw.staffMember.update({ where: { id: station.id }, data: { pinLockedUntil: null } });
  });

  it('cannot PIN-login staff from another venue through this device', async () => {
    const other = ctx.agent();
    await other
      .post('/v1/auth/signup')
      .send({
        ownerName: 'Other Owner',
        email: 'other@example.com',
        password: 'super-secret-1',
        pin: '9999',
        venueName: 'Other Place',
      })
      .expect(201);
    const otherOwner = await ctx.raw.staffMember.findUniqueOrThrow({
      where: { email: 'other@example.com' },
    });
    const agent = await loginOwner(ctx);
    await agent.post('/v1/auth/device').send({ name: 'Front tablet' }).expect(201);
    const res = await agent
      .post('/v1/auth/pin-login')
      .send({ staffId: otherOwner.id, pin: '9999' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('platform admin', () => {
  it('logs in with the seeded super-admin', async () => {
    const agent = ctx.agent();
    await agent.get('/v1/platform/auth/me').expect(401);
    await agent
      .post('/v1/platform/auth/login')
      .send({ email: DEMO.admin.email, password: 'wrong-pass-123' })
      .expect(401);
    await agent
      .post('/v1/platform/auth/login')
      .send({ email: DEMO.admin.email, password: DEMO.admin.password })
      .expect(200);
    const me = await agent.get('/v1/platform/auth/me').expect(200);
    expect(me.body.email).toBe(DEMO.admin.email);
  });

  it('rotates admin refresh tokens and revokes the session on logout', async () => {
    const login = await ctx
      .http()
      .post('/v1/platform/auth/login')
      .send({ email: DEMO.admin.email, password: DEMO.admin.password })
      .expect(200);
    const refreshed = await ctx
      .http()
      .post('/v1/platform/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    await ctx
      .http()
      .get('/v1/platform/auth/me')
      .set(bearer(refreshed.body.accessToken))
      .expect(200);
    // Staff refresh tokens are not admin refresh tokens and vice versa.
    await ctx
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
    await ctx
      .http()
      .post('/v1/platform/auth/logout')
      .set(bearer(refreshed.body.accessToken))
      .expect(200);
    await ctx
      .http()
      .get('/v1/platform/auth/me')
      .set(bearer(refreshed.body.accessToken))
      .expect(401);
    await ctx
      .http()
      .post('/v1/platform/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });

  it('does not accept a staff session as admin', async () => {
    const agent = await loginOwner(ctx);
    await agent.get('/v1/platform/auth/me').expect(401);
  });
});

describe('access and refresh tokens', () => {
  const login = () =>
    ctx
      .http()
      .post('/v1/auth/login')
      .send({ email: DEMO.owner.email, password: DEMO.owner.password })
      .expect(200);
  const refresh = (refreshToken: string) =>
    ctx.http().post('/v1/auth/refresh').send({ refreshToken });

  it('issues 15-minute access tokens and rejects expired or malformed ones', async () => {
    const { body } = await login();
    const jwt = ctx.app.get(JwtService);
    const claims = jwt.decode<{ iat: number; exp: number; sid: string }>(body.accessToken);
    expect(claims.exp - claims.iat).toBe(900);
    await ctx.http().get('/v1/auth/me').set(bearer(body.accessToken)).expect(200);
    const expired = jwt.sign({ typ: 'staff', sid: claims.sid, exp: claims.iat - 1 });
    await ctx.http().get('/v1/auth/me').set(bearer(expired)).expect(401);
    await ctx.http().get('/v1/auth/me').set(bearer('not-a-jwt')).expect(401);
    await ctx.http().get('/v1/auth/me').set('Authorization', body.accessToken).expect(401);
  });

  it('rotates the refresh token: the new pair works and the old token works only once', async () => {
    const first = (await login()).body;
    const second = await refresh(first.refreshToken).expect(200);
    expect(second.headers['cache-control']).toBe('no-store');
    expect(second.body.refreshToken).not.toBe(first.refreshToken);
    expect(second.body.refreshToken.split('.')[0]).toBe(first.refreshToken.split('.')[0]);
    await ctx.http().get('/v1/auth/me').set(bearer(second.body.accessToken)).expect(200);
    const third = await refresh(second.body.refreshToken).expect(200);
    await ctx.http().get('/v1/auth/me').set(bearer(third.body.accessToken)).expect(200);
  });

  it('revokes the whole session when an old refresh token is reused', async () => {
    const first = (await login()).body;
    const rotated = (await refresh(first.refreshToken).expect(200)).body;
    const reuse = await refresh(first.refreshToken).expect(401);
    expect(reuse.body.error.code).toBe('UNAUTHENTICATED');
    // Both the attacker's and the legitimate holder's tokens are now dead.
    await refresh(rotated.refreshToken).expect(401);
    await ctx.http().get('/v1/auth/me').set(bearer(rotated.accessToken)).expect(401);
    const sessionId = first.refreshToken.split('.')[0];
    const row = await ctx.raw.staffSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.revokedAt).not.toBeNull();
  });

  it('logout revokes the access and the refresh token at once', async () => {
    const tokens = (await login()).body;
    await ctx.http().post('/v1/auth/logout').set(bearer(tokens.accessToken)).expect(200);
    await ctx.http().get('/v1/auth/me').set(bearer(tokens.accessToken)).expect(401);
    await refresh(tokens.refreshToken).expect(401);
  });

  it('stops refreshing once the session reaches its absolute expiry', async () => {
    const tokens = (await login()).body;
    await ctx.raw.staffSession.update({
      where: { id: tokens.refreshToken.split('.')[0] },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await refresh(tokens.refreshToken).expect(401);
    await ctx.http().get('/v1/auth/me').set(bearer(tokens.accessToken)).expect(401);
  });

  it('rejects malformed and unknown refresh tokens without an error', async () => {
    for (const refreshToken of [
      'x'.repeat(40),
      `${'1'.repeat(36)}.${'a'.repeat(43)}`,
      `${randomUUID()}.${'a'.repeat(43)}`,
    ]) {
      const res = await refresh(refreshToken).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    await refresh('short').expect(400);
  });

  it('signs a deactivated staff member out everywhere', async () => {
    const owner = await loginOwner(ctx);
    const waiterAgent = await pinAgent(ctx, 'WAITER');
    const waiter = await staffByRole(ctx, 'WAITER');
    await owner.patch(`/v1/admin/staff/${waiter.id}`).send({ active: false }).expect(200);
    await waiterAgent.get('/v1/auth/me').expect(401);
    await refresh(waiterAgent.tokens.refreshToken!).expect(401);
    await owner.patch(`/v1/admin/staff/${waiter.id}`).send({ active: true }).expect(200);
  });

  it('a revoked device can neither refresh its sessions nor sign anyone in', async () => {
    const owner = await loginOwner(ctx);
    const device = await pinAgent(ctx, 'STATION');
    const me = await device.get('/v1/auth/me').expect(200);
    await owner.post(`/v1/admin/devices/${me.body.deviceId}/revoke`).expect(200);
    await device.get('/v1/auth/me').expect(401);
    await refresh(device.tokens.refreshToken!).expect(401);
    await device.get('/v1/auth/device').expect(401);
    const station = await staffByRole(ctx, 'STATION');
    const pin = await device
      .post('/v1/auth/pin-login')
      .send({ staffId: station.id, pin: DEMO.station.pin })
      .expect(401);
    expect(pin.body.error.code).toBe('DEVICE_NOT_REGISTERED');
  });

  it('uses the X-Device-Token header for the device, never a cookie', async () => {
    const owner = await loginOwner(ctx);
    const enabled = await owner.post('/v1/auth/device').send({ name: 'Header tablet' }).expect(201);
    expect(enabled.headers['set-cookie']).toBeUndefined();
    expect(enabled.headers['cache-control']).toBe('no-store');
    expect(enabled.body.deviceToken).toEqual(expect.any(String));
    await ctx.http().get('/v1/auth/device').expect(401);
    await ctx
      .http()
      .get('/v1/auth/device')
      .set('X-Device-Token', enabled.body.deviceToken)
      .expect(200);
  });
});

describe('rate limiting', () => {
  it('limits sign-in attempts per IP', async () => {
    const limited = await createTestContext({
      seed: false,
      env: { AUTH_RATE_LIMIT_PER_MINUTE: '3' },
    });
    try {
      for (let i = 0; i < 3; i++) {
        await limited
          .http()
          .post('/v1/auth/login')
          .send({ email: 'a@b.co', password: 'nope-nope' })
          .expect(401);
      }
      const res = await limited
        .http()
        .post('/v1/auth/login')
        .send({ email: 'a@b.co', password: 'nope-nope' })
        .expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
