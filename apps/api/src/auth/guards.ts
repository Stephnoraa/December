import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tenancy } from '@app/db';
import { hasPermission, type Permission } from '@app/shared';
import { AppError } from '../common/errors';
import type { AppRequest } from '../common/request';
import { COOKIE } from '../common/tokens.service';
import { SessionResolver } from './session-resolver.service';

const PERMISSIONS_KEY = 'qr:permissions';

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const principal = await this.sessions.staff(req.cookies?.[COOKIE.staff] as string | undefined);
    if (!principal) throw AppError.unauthenticated();
    tenancy.bindVenue(principal.venueId);
    req.staff = principal;
    const required =
      this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    for (const permission of required) {
      if (!hasPermission(principal.role, permission)) throw AppError.forbidden();
    }
    return true;
  }
}

@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly sessions: SessionResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const principal = await this.sessions.customer(
      req.cookies?.[COOKIE.customer] as string | undefined,
    );
    if (!principal) throw AppError.unauthenticated('Scan the QR code on your table to continue');
    tenancy.bindVenue(principal.venueId);
    req.customer = principal;
    return true;
  }
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly sessions: SessionResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const principal = await this.sessions.admin(req.cookies?.[COOKIE.admin] as string | undefined);
    if (!principal) throw AppError.unauthenticated();
    req.admin = principal;
    return true;
  }
}

/** Requires a signed-in staff member with all the given permissions. */
export const StaffAuth = (...permissions: Permission[]) =>
  applyDecorators(SetMetadata(PERMISSIONS_KEY, permissions), UseGuards(StaffGuard));

export const CustomerAuth = () => UseGuards(CustomerGuard);
export const AdminAuth = () => UseGuards(PlatformAdminGuard);

export const CurrentStaff = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const staff = ctx.switchToHttp().getRequest<AppRequest>().staff;
  if (!staff) throw AppError.unauthenticated();
  return staff;
});

export const CurrentCustomer = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const customer = ctx.switchToHttp().getRequest<AppRequest>().customer;
  if (!customer) throw AppError.unauthenticated();
  return customer;
});

export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const admin = ctx.switchToHttp().getRequest<AppRequest>().admin;
  if (!admin) throw AppError.unauthenticated();
  return admin;
});
