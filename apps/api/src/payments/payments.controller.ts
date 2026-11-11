import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  payoutSetupSchema,
  Permission,
  recordPaymentSchema,
  resolveAccountSchema,
  startPaymentSchema,
  type PayoutSetupInput,
  type RecordPaymentInput,
  type ResolveAccountInput,
  type StartPaymentInput,
} from '@app/shared';
import { CurrentCustomer, CurrentStaff, CustomerAuth, StaffAuth } from '../auth/guards';
import { ENV, type Env } from '../config/env';
import { PUBLIC_THROTTLE } from '../common/rate-limits';
import {
  clientIp,
  type AppRequest,
  type CustomerPrincipal,
  type StaffPrincipal,
} from '../common/request';
import { UuidParam, ZBody, ZodPipe } from '../common/zod.pipe';
import { PaymentsService } from './payments.service';

const referenceParam = z.string().regex(/^[A-Za-z0-9.=-]{6,100}$/);

@Controller('v1/public')
@Throttle(PUBLIC_THROTTLE)
export class PublicPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('session/payments')
  @CustomerAuth()
  start(
    @CurrentCustomer() customer: CustomerPrincipal,
    @ZBody(startPaymentSchema) body: StartPaymentInput,
  ) {
    return this.payments.startOnline(customer, body);
  }

  @Get('payments/:reference')
  @CustomerAuth()
  status(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Param('reference', new ZodPipe(referenceParam)) reference: string,
  ) {
    return this.payments.customerPaymentStatus(customer, reference);
  }

  @Post('payments/:reference/cancel')
  @HttpCode(200)
  @CustomerAuth()
  cancel(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Param('reference', new ZodPipe(referenceParam)) reference: string,
  ) {
    return this.payments.cancelPending(customer, reference);
  }

  /** Shareable on-screen receipt (unguessable token, no login). */
  @Get('receipts/:token')
  receipt(@Param('token') token: string) {
    return this.payments.receipt(token);
  }
}

@Controller('v1/webhooks')
@SkipThrottle()
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  /** Paystack webhook: signature checked over the raw body, then confirmed via verify. */
  @Post('paystack')
  @HttpCode(200)
  paystack(@Req() req: AppRequest, @Headers('x-paystack-signature') signature: string | undefined) {
    return this.payments.handleWebhook(req.rawBody, signature);
  }
}

@Controller('v1/staff')
export class StaffPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('sessions/:id/payments')
  @StaffAuth(Permission.PAYMENTS_RECORD)
  record(
    @CurrentStaff() staff: StaffPrincipal,
    @UuidParam() id: string,
    @ZBody(recordPaymentSchema) body: RecordPaymentInput,
    @Req() req: AppRequest,
  ) {
    return this.payments.recordStaffPayment(staff, id, body, clientIp(req));
  }
}

@Controller('v1/admin/payout')
export class PayoutController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('banks')
  @StaffAuth(Permission.VENUE_PAYOUT)
  banks() {
    return this.payments.listBanks();
  }

  @Post('resolve')
  @HttpCode(200)
  @StaffAuth(Permission.VENUE_PAYOUT)
  resolve(@ZBody(resolveAccountSchema) body: ResolveAccountInput) {
    return this.payments.resolveAccount(body.accountNumber, body.bankCode);
  }

  @Post()
  @HttpCode(200)
  @StaffAuth(Permission.VENUE_PAYOUT)
  configure(
    @CurrentStaff() staff: StaffPrincipal,
    @ZBody(payoutSetupSchema) body: PayoutSetupInput,
    @Req() req: AppRequest,
  ) {
    return this.payments.configurePayout(staff, body, clientIp(req));
  }
}

const completeSchema = z.object({
  outcome: z.enum(['success', 'failed']),
  channel: z.enum(['card', 'bank_transfer', 'ussd']).optional(),
});

/** Mock checkout used in local dev and tests. Never available in production. */
@Controller('v1/dev/mock-pay')
export class MockPayController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private guard() {
    if (!this.env.devRoutesEnabled || this.env.paymentsProvider !== 'mock')
      throw new NotFoundException();
  }

  @Get(':reference')
  info(@Param('reference', new ZodPipe(referenceParam)) reference: string) {
    this.guard();
    return this.payments.mockCheckoutInfo(reference);
  }

  @Post(':reference/complete')
  @HttpCode(200)
  complete(
    @Param('reference', new ZodPipe(referenceParam)) reference: string,
    @Body(new ZodPipe(completeSchema)) body: z.infer<typeof completeSchema>,
  ) {
    this.guard();
    return this.payments.completeMock(reference, body.outcome, body.channel);
  }
}
