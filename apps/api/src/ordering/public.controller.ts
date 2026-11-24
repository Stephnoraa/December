import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  createOrderSchema,
  refreshTokenSchema,
  serviceRequestSchema,
  type CreateOrderInput,
  type RefreshTokenInput,
  type ServiceRequestInput,
} from '@app/shared';
import { CustomerAuth, CurrentCustomer } from '../auth/guards';
import { SessionResolver } from '../auth/session-resolver.service';
import { SessionTokensService } from '../auth/session-tokens.service';
import { CredentialResponse } from '../common/idempotency.interceptor';
import { PUBLIC_THROTTLE } from '../common/rate-limits';
import type { AppRequest, CustomerPrincipal } from '../common/request';
import { bearerToken } from '../common/tokens.service';
import { ZBody } from '../common/zod.pipe';
import { CustomerService } from './customer.service';
import { OrdersService } from './orders.service';
import { PublicMenuService } from './public-menu.service';
import { SessionsService } from './sessions.service';

/** Customer endpoints: no login, ever. Identity is an anonymous bearer token per table session. */
@Controller('v1/public')
@Throttle(PUBLIC_THROTTLE)
export class PublicController {
  constructor(
    private readonly menu: PublicMenuService,
    private readonly customers: CustomerService,
    private readonly orders: OrdersService,
    private readonly sessions: SessionsService,
    private readonly resolver: SessionResolver,
    private readonly sessionTokens: SessionTokensService,
  ) {}

  private async currentCustomer(req: AppRequest) {
    return this.resolver.customer(bearerToken(req));
  }

  @Get('t/:slug/:token')
  async landing(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Req() req: AppRequest,
  ) {
    const resolved = await this.menu.resolveTable(slug, token);
    return this.customers.landing(resolved, await this.currentCustomer(req));
  }

  @Post('t/:slug/:token/join')
  @HttpCode(200)
  @CredentialResponse()
  async join(@Param('slug') slug: string, @Param('token') token: string, @Req() req: AppRequest) {
    const resolved = await this.menu.resolveTable(slug, token);
    const joined = await this.customers.join(resolved, await this.currentCustomer(req));
    const tokens = await this.sessionTokens.issueCustomer({
      ...joined,
      venueId: resolved.venue.id,
    });
    return { ok: true, tableSessionId: joined.tableSessionId, ...tokens };
  }

  @Post('session/refresh')
  @HttpCode(200)
  @CredentialResponse()
  refresh(@ZBody(refreshTokenSchema) body: RefreshTokenInput) {
    return this.sessionTokens.refreshCustomer(body.refreshToken);
  }

  /** "Call waiter" also works before the table is open (that's how customers ask for it). */
  @Post('t/:slug/:token/call-waiter')
  async callWaiter(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Req() req: AppRequest,
  ) {
    const resolved = await this.menu.resolveTable(slug, token);
    const live = await this.customers.liveSession(resolved.table.id);
    const customer = await this.currentCustomer(req);
    return this.sessions.request(
      { venueId: resolved.venue.id, tableId: resolved.table.id, tableSessionId: live?.id ?? null },
      'CALL_WAITER',
      customer,
    );
  }

  @Get('session')
  @CustomerAuth()
  session(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.customers.session(customer);
  }

  @Post('session/orders')
  @CustomerAuth()
  createOrder(
    @CurrentCustomer() customer: CustomerPrincipal,
    @ZBody(createOrderSchema) body: CreateOrderInput,
  ) {
    return this.orders.createCustomerOrder(customer, body);
  }

  @Post('session/requests')
  @CustomerAuth()
  async request(
    @CurrentCustomer() customer: CustomerPrincipal,
    @ZBody(serviceRequestSchema) body: ServiceRequestInput,
  ) {
    const live = await this.customers.liveSession(customer.tableId);
    return this.sessions.request(
      {
        venueId: customer.venueId,
        tableId: customer.tableId,
        tableSessionId: live?.id === customer.tableSessionId ? live.id : null,
      },
      body.type,
      customer,
    );
  }
}
