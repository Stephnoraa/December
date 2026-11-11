import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions, Response } from 'express';
import { ENV, type Env } from '../config/env';

export const COOKIE = {
  staff: 'qr_staff',
  device: 'qr_device',
  customer: 'qr_customer',
  admin: 'qr_admin',
} as const;

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
}
type Payload = StaffTokenPayload | CustomerTokenPayload | AdminTokenPayload;

/** Signs and verifies the HS256 JWTs carried in HttpOnly cookies. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  sign(payload: Payload, expiresInSeconds: number): string {
    return this.jwt.sign(payload, { expiresIn: expiresInSeconds, algorithm: 'HS256' });
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

  cookieOptions(maxAgeMs: number): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.cookieSecure,
      domain: this.env.COOKIE_DOMAIN,
      path: '/',
      maxAge: maxAgeMs,
    };
  }

  setCookie(res: Response, name: string, value: string, maxAgeMs: number): void {
    res.cookie(name, value, this.cookieOptions(maxAgeMs));
  }

  clearCookie(res: Response, name: string): void {
    const { maxAge: _maxAge, ...opts } = this.cookieOptions(0);
    res.clearCookie(name, opts);
  }
}
