import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokensDto } from '@app/shared';

/**
 * Bearer-token auth (works when the PWAs and the API are on different sites).
 * - Access token: HS256 JWT, 15 minutes, sent as `Authorization: Bearer …`. Guards still load
 *   the session row on every request, so revoking a session takes effect immediately.
 * - Refresh token: opaque `<sessionId>.<secret>`. Only a SHA-256 of the secret is stored; it is
 *   rotated on every use and presenting an old one revokes the whole session (reuse detection).
 * - Device token: long-lived opaque credential for PIN-login devices, sent as `X-Device-Token`.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const DEVICE_TOKEN_HEADER = 'x-device-token';

export type TokenType = 'staff' | 'customer' | 'admin';

export interface StaffTokenPayload {
  typ: 'staff';
  sid: string;
}
export interface CustomerTokenPayload {
  typ: 'customer';
  csid: string;
  tsid: string;
  vid: string;
}
export interface AdminTokenPayload {
  typ: 'admin';
  aid: string;
  sid: string;
}
type Payload = StaffTokenPayload | CustomerTokenPayload | AdminTokenPayload;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Reads `Authorization: Bearer <token>`. */
export function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export function deviceToken(req: Request): string | undefined {
  const value = req.headers[DEVICE_TOKEN_HEADER];
  return typeof value === 'string' && value ? value : undefined;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(payload: Payload): string {
    return this.jwt.sign(payload, { expiresIn: ACCESS_TOKEN_TTL_SECONDS, algorithm: 'HS256' });
  }

  verify<T extends Payload>(token: string | undefined, typ: T['typ']): T | null {
    if (!token) return null;
    try {
      const payload = this.jwt.verify<T & { exp: number }>(token, { algorithms: ['HS256'] });
      return payload.typ === typ ? payload : null;
    } catch {
      return null;
    }
  }

  /** A fresh refresh secret and the hash to store on the session row. */
  newRefreshSecret(): { secret: string; hash: string } {
    const secret = randomBytes(32).toString('base64url');
    return { secret, hash: sha256(secret) };
  }

  refreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  /** Splits a refresh token into the session id and the hash of its secret. */
  parseRefreshToken(token: string): { sessionId: string; hash: string } | null {
    const dot = token.indexOf('.');
    const sessionId = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (dot <= 0 || !UUID.test(sessionId) || !secret) return null;
    return { sessionId, hash: sha256(secret) };
  }

  pair(access: Payload, refreshToken: string): AuthTokensDto {
    return {
      accessToken: this.signAccess(access),
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}
