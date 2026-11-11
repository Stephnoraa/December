import { Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  createOrderSchema,
  serviceRequestSchema,
  type CreateOrderInput,
  type ServiceRequestInput,
} from '@app/shared';
import { CustomerAuth, CurrentCustomer } from '../auth/guards';
import { SessionResolver } from '../auth/session-resolver.service';
import { PUBLIC_THROTTLE } from '../common/rate-limits';
import type { AppRequest, CustomerPrincipal } from '../common/request';
import { COOKIE, TokenService } from '../common/tokens.service';
import { ZBody } from '../common/zod.pipe';
import { CustomerService } from './customer.service';
import { OrdersService } from './orders.service';
import { PublicMenuService } from './public-menu.service';
import { SessionsService } from './sessions.service';

const CUSTOMER_COOKIE_HOURS = 12;

/** Customer endpoints: no login, ever. Identity is an anonymous signed cookie per table session. */
@Controller('v1/public')
@Throttle(PUBLIC_THROTTLE)
export class PublicController {
  constructor(
    private readonly menu: PublicMenuService,
    private readonly customers: CustomerService,
    private readonly orders: OrdersService,
    private readonly sessions: SessionsService,
    private readonly resolver: SessionResolver,
    private readonly tokens: TokenService,
  ) {}

  private async currentCustomer(req: AppRequest) {
    return this.resolver.customer(req.cookies?.[COOKIE.customer] as string | undefined);
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
  async join(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resolved = await this.menu.resolveTable(slug, token);
    const joined = await this.customers.join(resolved, await this.currentCustomer(req));
    const ttl = CUSTOMER_COOKIE_HOURS * 3600_000;
    const jwt = this.tokens.sign(
      {
        typ: 'customer',
        csid: joined.customerSessionId,
        tsid: joined.tableSessionId,
        vid: resolved.venue.id,
      },
      ttl / 1000,
    );
    this.tokens.setCookie(res, COOKIE.customer, jwt, ttl);
    return { ok: true, tableSessionId: joined.tableSessionId };
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
