import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  enableDeviceSchema,
  loginSchema,
  pinLoginSchema,
  platformLoginSchema,
  signupSchema,
  type EnableDeviceInput,
  type LoginInput,
  type PinLoginInput,
  type SignupInput,
} from '@app/shared';
import { ZBody } from '../common/zod.pipe';
import {
  clientIp,
  type AdminPrincipal,
  type AppRequest,
  type StaffPrincipal,
} from '../common/request';
import { COOKIE, TokenService } from '../common/tokens.service';
import { AuthService, DEVICE_COOKIE_DAYS } from './auth.service';
import { AdminAuth, CurrentAdmin, CurrentStaff, StaffAuth } from './guards';
import { Permission } from '@app/shared';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const ADMIN_SESSION_HOURS = 12;

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  private setStaffSession(res: Response, session: { sessionId: string; expiresAt: Date }) {
    const ttl = session.expiresAt.getTime() - Date.now();
    const token = this.tokens.sign(
      { typ: 'staff', sid: session.sessionId },
      Math.floor(ttl / 1000),
    );
    this.tokens.setCookie(res, COOKIE.staff, token, ttl);
  }

  @Post('signup')
  @Throttle(AUTH_THROTTLE)
  async signup(
    @ZBody(signupSchema) body: SignupInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.signup(body, clientIp(req));
    this.setStaffSession(res, session);
    return { ok: true };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async login(@ZBody(loginSchema) body: LoginInput, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.passwordLogin(body);
    this.setStaffSession(res, session);
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  @StaffAuth()
  async logout(@CurrentStaff() staff: StaffPrincipal, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(staff.sessionId);
    this.tokens.clearCookie(res, COOKIE.staff);
    return { ok: true };
  }

  @Get('me')
  @StaffAuth()
  me(@CurrentStaff() staff: StaffPrincipal) {
    return this.auth.me(staff);
  }

  /** Enables PIN login on the current device (manager/owner signed in with a password). */
  @Post('device')
  @StaffAuth(Permission.DEVICES_MANAGE)
  async enableDevice(
    @CurrentStaff() staff: StaffPrincipal,
    @ZBody(enableDeviceSchema) body: EnableDeviceInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, deviceId } = await this.auth.enableDevice(staff, body.name, clientIp(req));
    this.tokens.setCookie(res, COOKIE.device, token, DEVICE_COOKIE_DAYS * 86_400_000);
    return { deviceId };
  }

  @Get('device')
  device(@Req() req: AppRequest) {
    return this.auth.deviceInfo(req.cookies?.[COOKIE.device] as string | undefined);
  }

  @Post('pin-login')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async pinLogin(
    @ZBody(pinLoginSchema) body: PinLoginInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.pinLogin(
      req.cookies?.[COOKIE.device] as string | undefined,
      body,
      clientIp(req),
    );
    this.setStaffSession(res, session);
    return { ok: true };
  }
}

@Controller('v1/platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async login(
    @ZBody(platformLoginSchema) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { adminId } = await this.auth.platformLogin(body);
    const ttl = ADMIN_SESSION_HOURS * 3600_000;
    this.tokens.setCookie(
      res,
      COOKIE.admin,
      this.tokens.sign({ typ: 'admin', aid: adminId }, ttl / 1000),
      ttl,
    );
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    this.tokens.clearCookie(res, COOKIE.admin);
    return { ok: true };
  }

  @Get('me')
  @AdminAuth()
  me(@CurrentAdmin() admin: AdminPrincipal) {
    return { id: admin.adminId, email: admin.email };
  }
}
