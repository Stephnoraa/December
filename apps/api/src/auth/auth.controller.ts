import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  enableDeviceSchema,
  loginSchema,
  Permission,
  pinLoginSchema,
  platformLoginSchema,
  refreshTokenSchema,
  signupSchema,
  type EnableDeviceInput,
  type LoginInput,
  type PinLoginInput,
  type RefreshTokenInput,
  type SignupInput,
} from '@app/shared';
import { CredentialResponse } from '../common/idempotency.interceptor';
import { AUTH_THROTTLE } from '../common/rate-limits';
import {
  clientIp,
  type AdminPrincipal,
  type AppRequest,
  type StaffPrincipal,
} from '../common/request';
import { deviceToken } from '../common/tokens.service';
import { ZBody } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { AdminAuth, CurrentAdmin, CurrentStaff, StaffAuth } from './guards';
import { SessionTokensService } from './session-tokens.service';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessionTokens: SessionTokensService,
  ) {}

  @Post('signup')
  @Throttle(AUTH_THROTTLE)
  @CredentialResponse()
  signup(@ZBody(signupSchema) body: SignupInput, @Req() req: AppRequest) {
    return this.auth.signup(body, clientIp(req));
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  @CredentialResponse()
  login(@ZBody(loginSchema) body: LoginInput) {
    return this.auth.passwordLogin(body);
  }

  /** Trades a refresh token for a new token pair (the old refresh token stops working). */
  @Post('refresh')
  @HttpCode(200)
  @CredentialResponse()
  refresh(@ZBody(refreshTokenSchema) body: RefreshTokenInput) {
    return this.sessionTokens.refreshStaff(body.refreshToken);
  }

  /** Revokes the session: its access and refresh tokens stop working immediately. */
  @Post('logout')
  @HttpCode(200)
  @StaffAuth()
  async logout(@CurrentStaff() staff: StaffPrincipal) {
    await this.auth.logout(staff.sessionId);
    return { ok: true };
  }

  @Get('me')
  @StaffAuth()
  me(@CurrentStaff() staff: StaffPrincipal) {
    return this.auth.me(staff);
  }

  /**
   * Enables PIN login on the current device (manager/owner signed in with a password).
   * The client keeps `deviceToken` and sends it as `X-Device-Token` on the device endpoints.
   */
  @Post('device')
  @StaffAuth(Permission.DEVICES_MANAGE)
  @CredentialResponse()
  async enableDevice(
    @CurrentStaff() staff: StaffPrincipal,
    @ZBody(enableDeviceSchema) body: EnableDeviceInput,
    @Req() req: AppRequest,
  ) {
    const { token, deviceId } = await this.auth.enableDevice(staff, body.name, clientIp(req));
    return { deviceId, deviceToken: token };
  }

  @Get('device')
  device(@Req() req: AppRequest) {
    return this.auth.deviceInfo(deviceToken(req));
  }

  @Post('pin-login')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  @CredentialResponse()
  pinLogin(@ZBody(pinLoginSchema) body: PinLoginInput, @Req() req: AppRequest) {
    return this.auth.pinLogin(deviceToken(req), body, clientIp(req));
  }
}

@Controller('v1/platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessionTokens: SessionTokensService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  @CredentialResponse()
  login(@ZBody(platformLoginSchema) body: LoginInput) {
    return this.auth.platformLogin(body);
  }

  @Post('refresh')
  @HttpCode(200)
  @CredentialResponse()
  refresh(@ZBody(refreshTokenSchema) body: RefreshTokenInput) {
    return this.sessionTokens.refreshAdmin(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @AdminAuth()
  async logout(@CurrentAdmin() admin: AdminPrincipal) {
    await this.sessionTokens.revokeAdmin(admin.sessionId);
    return { ok: true };
  }

  @Get('me')
  @AdminAuth()
  me(@CurrentAdmin() admin: AdminPrincipal) {
    return { id: admin.adminId, email: admin.email };
  }
}
