import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { lockRow, Prisma, tenancy, type DbClient, type DbTx } from '@app/db';
import {
  ErrorCode,
  paymentBucket,
  Rooms,
  SocketEvent,
  type PaymentStatusDto,
  type ReceiptDto,
  type RecordPaymentInput,
  type StartPaymentDto,
  type StartPaymentInput,
} from '@app/shared';
import { ENV, type Env } from '../config/env';
import { AuditService } from '../common/audit.service';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import { EventsService, type PendingEvent } from '../common/events.service';
import type { CustomerPrincipal, StaffPrincipal } from '../common/request';
import { notify } from '../ordering/notify';
import { OrdersService } from '../ordering/orders.service';
import {
  computeTotals,
  prepayAmountDue,
  TabsService,
  type TabWithRelations,
} from '../ordering/tabs.service';
import { QrTokenService } from '../qr/qr-token.service';
import { StorageService } from '../storage/storage.service';
import { PaymentProvider } from './payment-provider';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

type PaymentRow = TabWithRelations['payments'][number];

function newReference(prefix: string): string {
  return `${prefix}-${randomBytes(12).toString('hex')}`;
}

/** Sum of online payments still holding part of the balance (pending and not yet expired). */
export function activeReservations(
  payments: PaymentRow[],
  now = new Date(),
  excludeOrderPayments = true,
): number {
  return payments
    .filter(
      (p) =>
        p.status === 'PENDING' &&
        p.method === 'PAYSTACK' &&
        (!excludeOrderPayments || !p.orderId) &&
        p.reservedUntil !== null &&
        p.reservedUntil > now,
    )
    .reduce((s, p) => s + p.amountKobo, 0);
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    @InjectDb() private readonly db: DbClient,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
    private readonly tabs: TabsService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly qr: QrTokenService,
    private readonly storage: StorageService,
  ) {}

  private paymentEvents(
    venueId: string,
    tableSessionId: string,
    tab: { id: string; version: number },
    paymentId: string,
  ): PendingEvent[] {
    return [
      {
        rooms: [Rooms.tableSession(tableSessionId), Rooms.venue(venueId), Rooms.owner(venueId)],
        event: SocketEvent.PAYMENT_UPDATED,
        payload: { venueId, tableSessionId, tabId: tab.id, paymentId, version: tab.version },
      },
      ...notify.tab(venueId, tableSessionId, tab.id, tab.version),
    ];
  }

  // ---- Customer online payments -------------------------------------------------------------

  /**
   * Starts a Paystack checkout. The tab row is locked while the amount is worked out, and the
   * pending payment reserves its share of the balance so two people paying at once cannot both
   * pay the full amount.
   */
  async startOnline(
    customer: CustomerPrincipal,
    input: StartPaymentInput,
  ): Promise<StartPaymentDto> {
    const session = await this.db.tableSession.findUnique({
      where: { id: customer.tableSessionId },
      include: { venue: true, table: true, tab: true },
    });
    if (!session?.tab) throw AppError.unauthenticated('Scan the QR code on your table to continue');
    const venue = session.venue;
    if (!venue.paystackSubaccountCode) {
      throw AppError.conflict(
        ErrorCode.ONLINE_PAYMENTS_DISABLED,
        'Online payment is not available here yet. Please pay your waiter.',
      );
    }
    if (session.status !== 'OPEN')
      throw AppError.conflict(ErrorCode.TABLE_NOT_OPEN, 'This table is closed');
    const now = new Date();
    const reference = newReference('qr');
    const payment = await this.db.$transaction(async (tx) => {
      const tab = await this.tabs.recalculate(tx, session.tab!.id, customer.venueId);
      let amount: number;
      let orderId: string | null = null;
      if (input.mode === 'ORDER') {
        const order = tab.orders.find((o) => o.id === input.orderId);
        if (!order || order.status !== 'AWAITING_PAYMENT') {
          throw AppError.conflict(ErrorCode.NOTHING_TO_PAY, 'This order does not need paying');
        }
        const other = tab.payments.find(
          (p) =>
            p.orderId === order.id &&
            p.status === 'PENDING' &&
            p.reservedUntil &&
            p.reservedUntil > now &&
            p.customerSessionId !== customer.customerSessionId,
        );
        if (other)
          throw AppError.conflict(
            ErrorCode.BALANCE_RESERVED,
            'Someone at your table is already paying for this order',
          );
        // A new attempt by the same person supersedes their unfinished one.
        await tx.payment.updateMany({
          where: {
            orderId: order.id,
            status: 'PENDING',
            customerSessionId: customer.customerSessionId,
          },
          data: { reservedUntil: now },
        });
        amount = prepayAmountDue(tab, order.id);
        orderId = order.id;
      } else {
        // Your own unfinished attempts no longer hold the balance once you start again.
        await tx.payment.updateMany({
          where: {
            tabId: tab.id,
            status: 'PENDING',
            orderId: null,
            customerSessionId: customer.customerSessionId,
          },
          data: { reservedUntil: now },
        });
        const reserved = activeReservations(
          tab.payments.filter((p) => p.customerSessionId !== customer.customerSessionId),
          now,
        );
        const available = tab.balanceKobo - reserved;
        if (available <= 0) {
          if (reserved > 0) {
            throw AppError.conflict(
              ErrorCode.BALANCE_RESERVED,
              'Someone at your table is paying the rest right now',
              { reservedKobo: reserved },
            );
          }
          throw AppError.conflict(ErrorCode.NOTHING_TO_PAY, 'Nothing left to pay');
        }
        if (input.mode === 'CUSTOM') {
          if (input.amountKobo > available) {
            throw AppError.conflict(
              reserved > 0 ? ErrorCode.BALANCE_RESERVED : ErrorCode.AMOUNT_EXCEEDS_BALANCE,
              'That is more than what is left to pay',
              { availableKobo: available },
            );
          }
          amount = input.amountKobo;
        } else {
          amount = available;
        }
      }
      if (amount <= 0) throw AppError.conflict(ErrorCode.NOTHING_TO_PAY, 'Nothing to pay');
      return tx.payment.create({
        data: {
          venueId: customer.venueId,
          tabId: tab.id,
          orderId,
          amountKobo: amount,
          method: 'PAYSTACK',
          status: 'PENDING',
          reference,
          email: input.email,
          customerSessionId: customer.customerSessionId,
          reservedUntil: new Date(now.getTime() + this.env.PAYMENT_RESERVATION_MINUTES * 60_000),
        },
      });
    });

    const callbackUrl = `${this.qr.tableUrl(venue.slug, { venueId: venue.id, tableId: session.tableId, version: session.table.qrVersion })}?payment=${reference}`;
    try {
      const init = await this.provider.initialize({
        reference,
        amountKobo: payment.amountKobo,
        email: input.email,
        subaccountCode: venue.paystackSubaccountCode,
        callbackUrl,
        metadata: {
          venueId: venue.id,
          tabId: payment.tabId,
          paymentId: payment.id,
          orderId: payment.orderId,
          table: session.table.label,
        },
      });
      await this.db.payment.update({
        where: { id: payment.id },
        data: { authorizationUrl: init.authorizationUrl },
      });
      return {
        paymentId: payment.id,
        reference,
        amountKobo: payment.amountKobo,
        authorizationUrl: init.authorizationUrl,
      };
    } catch (err) {
      await this.db.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: 'initialize failed', reservedUntil: null },
      });
      throw err;
    }
  }

  async customerPaymentStatus(
    customer: CustomerPrincipal,
    reference: string,
  ): Promise<PaymentStatusDto> {
    let payment = await this.db.payment.findUnique({
      where: { reference },
      include: { tab: true },
    });
    if (!payment || payment.tab.tableSessionId !== customer.tableSessionId)
      throw AppError.notFound('Payment');
    if (payment.status === 'PENDING') {
      // Coming back from checkout: ask Paystack directly rather than trusting the redirect.
      await this.confirm(reference, 'return').catch((err: unknown) =>
        this.logger.warn(`verify on return failed: ${String(err)}`),
      );
      payment = await this.db.payment.findUniqueOrThrow({
        where: { reference },
        include: { tab: true },
      });
    }
    return {
      reference,
      status: payment.status,
      amountKobo: payment.amountKobo,
      tabBalanceKobo: payment.tab.balanceKobo,
      receiptToken: payment.tab.receiptToken,
    };
  }

  /** The customer backed out of checkout: release their reservation unless Paystack says paid. */
  async cancelPending(customer: CustomerPrincipal, reference: string): Promise<PaymentStatusDto> {
    const payment = await this.db.payment.findUnique({ where: { reference } });
    if (!payment || payment.customerSessionId !== customer.customerSessionId)
      throw AppError.notFound('Payment');
    if (payment.status === 'PENDING') {
      const result = await this.confirm(reference, 'cancel');
      if (result !== 'success') {
        await this.db.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: { status: 'FAILED', failureReason: 'cancelled by customer', reservedUntil: null },
        });
        const tab = await this.db.tab.update({
          where: { id: payment.tabId },
          data: { version: { increment: 1 } },
        });
        this.events.emitAll(
          this.paymentEvents(payment.venueId, tab.tableSessionId, tab, payment.id),
        );
      }
    }
    return this.customerPaymentStatus(customer, reference);
  }

  // ---- Confirmation (webhook, return, reconciliation) ---------------------------------------

  /**
   * Verifies a payment with the provider and, if Paystack confirms it, records it. Idempotent by
   * reference: a payment already SUCCESS is never applied twice. Must run in the payment's venue
   * context. Returns the provider status.
   */
  async confirm(
    reference: string,
    source: 'webhook' | 'return' | 'reconcile' | 'cancel',
  ): Promise<string> {
    const existing = await this.db.payment.findUnique({ where: { reference } });
    if (!existing) throw AppError.notFound('Payment');
    if (existing.status === 'SUCCESS') return 'success';
    const verified = await this.provider.verify(reference);
    await this.db.payment.update({
      where: { id: existing.id },
      data: { lastCheckedAt: new Date() },
    });
    if (verified.status !== 'success') return verified.status;
    if (verified.currency !== 'NGN') {
      this.logger.error(`Payment ${reference} verified in ${verified.currency}, not NGN`);
      return 'unknown';
    }

    const outcome = await this.db.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'Tab', existing.tabId, existing.venueId)))
        throw AppError.notFound('Tab');
      await lockRow(tx, 'Payment', existing.id, existing.venueId);
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: existing.id } });
      if (payment.status === 'SUCCESS') return null;
      const before = await this.tabs.recalculate(tx, payment.tabId, payment.venueId);
      const amount = verified.amountKobo;
      if (amount !== payment.amountKobo) {
        this.logger.warn(
          `Payment ${reference}: expected ${payment.amountKobo} kobo, Paystack confirmed ${amount}`,
        );
      }
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          amountKobo: amount,
          channel: verified.channel,
          verifiedAt: verified.paidAt ?? new Date(),
          reservedUntil: null,
          failureReason: null,
          providerPayload: verified.raw as Prisma.InputJsonValue,
        },
      });
      let stationIds: string[] = [];
      if (payment.orderId)
        stationIds = (await this.orders.releaseOrderTx(tx, payment.orderId)).stationIds;
      const after = await this.tabs.recalculate(tx, payment.tabId, payment.venueId);
      const newlyOverpaid = Math.min(amount, Math.max(0, after.overpaidKobo - before.overpaidKobo));
      if (newlyOverpaid > 0)
        await tx.payment.update({
          where: { id: payment.id },
          data: { overpaidKobo: newlyOverpaid },
        });
      await this.audit.record(tx, {
        venueId: payment.venueId,
        actor: { kind: 'system' },
        action: 'PAYMENT_CONFIRMED',
        entityType: 'Payment',
        entityId: payment.id,
        after: {
          reference,
          amountKobo: amount,
          channel: verified.channel,
          source,
          orderId: payment.orderId,
        },
      });
      if (newlyOverpaid > 0) {
        await this.audit.record(tx, {
          venueId: payment.venueId,
          actor: { kind: 'system' },
          action: 'OVERPAYMENT_FLAGGED',
          entityType: 'Payment',
          entityId: payment.id,
          after: { reference, overpaidKobo: newlyOverpaid, tabId: payment.tabId },
          reason: 'Collected more than the balance: refund due',
        });
      }
      return { payment, tab: after, stationIds };
    });
    if (outcome) {
      const events = this.paymentEvents(
        outcome.payment.venueId,
        outcome.tab.tableSessionId,
        outcome.tab,
        outcome.payment.id,
      );
      if (outcome.payment.orderId) {
        events.push(
          notify.order(
            outcome.payment.venueId,
            outcome.tab.tableSessionId,
            outcome.payment.orderId,
            0,
          ),
        );
        events.push(...notify.stations(outcome.payment.venueId, outcome.stationIds));
      }
      this.events.emitAll(events);
    }
    return 'success';
  }

  /**
   * Paystack webhook. The raw event is stored first (deduplicated by body hash), then the
   * signature is checked and the payment confirmed via the verify endpoint.
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ ok: boolean; duplicate?: boolean }> {
    if (!rawBody || rawBody.length === 0)
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Empty body');
    const signatureValid = this.provider.verifyWebhookSignature(rawBody, signature);
    let payload: { event?: string; data?: { reference?: string } };
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as typeof payload;
    } catch {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Invalid JSON');
    }
    const dedupeKey = createHash('sha256').update(rawBody).digest('hex');
    const reference = typeof payload.data?.reference === 'string' ? payload.data.reference : null;
    return tenancy.runAsSystem(async () => {
      const prior = await this.db.webhookEvent.findUnique({ where: { dedupeKey } });
      if (prior?.processedAt && prior.signatureValid) return { ok: true, duplicate: true };
      const stored =
        prior ??
        (await this.db.webhookEvent.create({
          data: {
            provider: this.provider.name,
            dedupeKey,
            eventType: String(payload.event ?? 'unknown'),
            reference,
            signatureValid,
            payload: payload as Prisma.InputJsonValue,
          },
        }));
      if (!signatureValid) {
        this.logger.warn(`Rejected webhook with invalid signature (event ${stored.id})`);
        throw new AppError(ErrorCode.FORBIDDEN, 'Invalid signature', HttpStatus.UNAUTHORIZED);
      }
      let error: string | null = null;
      if (payload.event === 'charge.success' && reference) {
        const payment = await this.db.payment.findUnique({ where: { reference } });
        if (!payment) {
          error = 'unknown reference';
        } else {
          try {
            await tenancy.runForVenue(payment.venueId, () => this.confirm(reference, 'webhook'));
          } catch (err) {
            error = String(err);
            await this.db.webhookEvent.update({
              where: { id: stored.id },
              data: { processingError: error },
            });
            throw err; // non-2xx so Paystack retries
          }
        }
      }
      await this.db.webhookEvent.update({
        where: { id: stored.id },
        data: { processedAt: new Date(), processingError: error, signatureValid: true },
      });
      return { ok: true };
    });
  }

  /** Scheduled: re-verify pending payments older than a few minutes; expire abandoned ones. */
  async reconcile(
    now = new Date(),
  ): Promise<{ checked: number; confirmed: number; failed: number }> {
    const stale = await tenancy.runAsSystem(() =>
      this.db.payment.findMany({
        where: {
          status: 'PENDING',
          method: 'PAYSTACK',
          createdAt: { lt: new Date(now.getTime() - this.env.RECONCILE_AFTER_MINUTES * 60_000) },
          OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lt: new Date(now.getTime() - 60_000) } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
    );
    let confirmed = 0;
    let failed = 0;
    for (const p of stale) {
      try {
        const status = await tenancy.runForVenue(p.venueId, () =>
          this.confirm(p.reference, 'reconcile'),
        );
        if (status === 'success') {
          confirmed++;
        } else if (
          status === 'failed' ||
          p.createdAt.getTime() < now.getTime() - this.env.PAYMENT_ABANDON_MINUTES * 60_000
        ) {
          await tenancy.runForVenue(p.venueId, async () => {
            const res = await this.db.payment.updateMany({
              where: { id: p.id, status: 'PENDING' },
              data: {
                status: 'FAILED',
                failureReason: status === 'failed' ? 'declined' : 'abandoned',
                reservedUntil: null,
              },
            });
            if (res.count) {
              const tab = await this.db.tab.update({
                where: { id: p.tabId },
                data: { version: { increment: 1 } },
              });
              this.events.emitAll(this.paymentEvents(p.venueId, tab.tableSessionId, tab, p.id));
            }
          });
          failed++;
        }
      } catch (err) {
        this.logger.warn(`Reconcile ${p.reference} failed: ${String(err)}`);
      }
    }
    return { checked: stale.length, confirmed, failed };
  }

  /** Scheduled: cancel PREPAY orders nobody paid for. */
  async expirePrepayOrders(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.env.PREPAY_ORDER_EXPIRY_MINUTES * 60_000);
    const stale = await tenancy.runAsSystem(() =>
      this.db.order.findMany({
        where: {
          status: 'AWAITING_PAYMENT',
          createdAt: { lt: cutoff },
          payments: { none: { status: 'PENDING', reservedUntil: { gt: now } } },
        },
        select: { id: true, venueId: true, tabId: true, tableSessionId: true },
        take: 200,
      }),
    );
    for (const o of stale) {
      await tenancy.runForVenue(o.venueId, async () => {
        const res = await this.db.order.updateMany({
          where: { id: o.id, status: 'AWAITING_PAYMENT' },
          data: { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } },
        });
        if (res.count) {
          const tab = await this.db.tab.update({
            where: { id: o.tabId },
            data: { version: { increment: 1 } },
          });
          this.events.emitAll([
            notify.order(o.venueId, o.tableSessionId, o.id, 0),
            ...notify.tab(o.venueId, o.tableSessionId, tab.id, tab.version),
          ]);
        }
      });
    }
    return stale.length;
  }

  // ---- Staff cash / POS -----------------------------------------------------------------------

  async recordStaffPayment(
    staff: StaffPrincipal,
    tableSessionId: string,
    input: RecordPaymentInput,
    ip: string | null,
  ) {
    const session = await this.db.tableSession.findUnique({
      where: { id: tableSessionId },
      include: { tab: true },
    });
    if (!session?.tab) throw AppError.notFound('Table session');
    if (session.status !== 'OPEN')
      throw AppError.conflict(ErrorCode.TABLE_NOT_OPEN, 'This table is closed');
    const tabId = session.tab.id;
    const result = await this.db.$transaction(async (tx) => {
      const tab = await this.tabs.recalculate(tx, tabId, staff.venueId);
      let stationIds: string[] = [];
      if (input.orderId) {
        const order = tab.orders.find((o) => o.id === input.orderId);
        if (!order || order.status !== 'AWAITING_PAYMENT')
          throw AppError.conflict(ErrorCode.NOTHING_TO_PAY, 'This order does not need paying');
        const due = prepayAmountDue(tab, order.id);
        if (input.amountKobo !== due) {
          throw new AppError(
            ErrorCode.VALIDATION_FAILED,
            `This order needs exactly ${due} kobo`,
            HttpStatus.BAD_REQUEST,
            { dueKobo: due },
          );
        }
      } else if (input.amountKobo > tab.balanceKobo) {
        throw AppError.conflict(
          ErrorCode.AMOUNT_EXCEEDS_BALANCE,
          'That is more than the balance. Record the balance and give change.',
          {
            balanceKobo: tab.balanceKobo,
          },
        );
      }
      const payment = await tx.payment.create({
        data: {
          venueId: staff.venueId,
          tabId,
          orderId: input.orderId ?? null,
          amountKobo: input.amountKobo,
          method: input.method,
          status: 'SUCCESS',
          reference: newReference(input.method.toLowerCase()),
          recordedByStaffId: staff.staffId,
          note: input.note ?? null,
          verifiedAt: new Date(),
        },
      });
      if (input.orderId)
        stationIds = (await this.orders.releaseOrderTx(tx, input.orderId)).stationIds;
      const after = await this.tabs.recalculate(tx, tabId, staff.venueId);
      await this.audit.record(tx, {
        venueId: staff.venueId,
        actor: staff,
        action: 'PAYMENT_RECORDED',
        entityType: 'Payment',
        entityId: payment.id,
        after: {
          method: input.method,
          amountKobo: input.amountKobo,
          tabId,
          orderId: input.orderId ?? null,
          note: input.note ?? null,
        },
        ip,
      });
      return { payment, tab: after, stationIds };
    });
    const events = this.paymentEvents(staff.venueId, tableSessionId, result.tab, result.payment.id);
    if (input.orderId) events.push(...notify.stations(staff.venueId, result.stationIds));
    this.events.emitAll(events);
    return this.tabs.paymentDto(result.payment, {});
  }

  // ---- Receipt -------------------------------------------------------------------------------

  async receipt(token: string): Promise<ReceiptDto> {
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) throw AppError.notFound('Receipt');
    const found = await tenancy.runAsSystem(() =>
      this.db.tab.findUnique({
        where: { receiptToken: token },
        select: { id: true, venueId: true },
      }),
    );
    if (!found) throw AppError.notFound('Receipt');
    return tenancy.runForVenue(found.venueId, async () => {
      const tab = await this.tabs.load(this.db, found.id);
      const session = await this.db.tableSession.findUniqueOrThrow({
        where: { id: tab.tableSessionId },
        include: { table: true, venue: true },
      });
      const totals = computeTotals(tab);
      const applied = new Map(totals.discounts.map((d) => [d.id, d.appliedKobo]));
      return {
        venue: {
          name: session.venue.name,
          address: session.venue.address,
          logoUrl: this.storage.publicUrl(session.venue.logoKey),
        },
        table: { label: session.table.label, area: session.table.area },
        tabStatus: tab.status,
        openedAt: session.openedAt.toISOString(),
        closedAt: session.closedAt?.toISOString() ?? null,
        items: tab.orders
          .filter((o) => o.status === 'PLACED')
          .flatMap((o) => o.items)
          .map((i) => ({
            name: i.name,
            addOns: ((i.addOns as { name: string }[]) ?? []).map((a) => a.name),
            quantity: i.quantity,
            unitPriceKobo: i.unitPriceKobo,
            lineTotalKobo: i.unitPriceKobo * i.quantity,
            status: i.status,
          })),
        adjustments: tab.adjustments.map((a) => ({
          type: a.type,
          reason: a.reason,
          appliedKobo: a.type === 'VOID' ? (a.amountKobo ?? 0) : (applied.get(a.id) ?? 0),
        })),
        totals: this.tabs.totalsDto(tab),
        payments: tab.payments
          .filter((p) => p.status === 'SUCCESS')
          .map((p) => ({
            method: p.method,
            bucket: paymentBucket(p.method, p.channel),
            amountKobo: p.amountKobo,
            verifiedAt: p.verifiedAt?.toISOString() ?? null,
            reference: p.reference,
          })),
      };
    });
  }

  // ---- Payout onboarding (owner) ----------------------------------------------------------

  listBanks() {
    return this.provider.listBanks();
  }

  resolveAccount(accountNumber: string, bankCode: string) {
    return this.provider.resolveAccount(accountNumber, bankCode);
  }

  async configurePayout(
    staff: StaffPrincipal,
    input: { bankCode: string; bankName: string; accountNumber: string },
    ip: string | null,
  ) {
    const venue = await this.db.venue.findUniqueOrThrow({ where: { id: staff.venueId } });
    const { accountName } = await this.provider.resolveAccount(input.accountNumber, input.bankCode);
    const { subaccountCode } = await this.provider.createSubaccount({
      businessName: venue.name,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      percentageCharge: this.env.PAYSTACK_SUBACCOUNT_PERCENTAGE,
      description: `QR ordering payouts for ${venue.name} (${venue.slug})`,
    });
    await this.db.$transaction(async (tx: DbTx) => {
      await tx.venue.update({
        where: { id: staff.venueId },
        data: {
          paystackSubaccountCode: subaccountCode,
          payoutBankCode: input.bankCode,
          payoutBankName: input.bankName,
          payoutAccountNumber: input.accountNumber,
          payoutAccountName: accountName,
          payoutConfiguredAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        venueId: staff.venueId,
        actor: staff,
        action: 'PAYOUT_CONFIGURED',
        entityType: 'Venue',
        entityId: staff.venueId,
        before: {
          subaccountCode: venue.paystackSubaccountCode,
          bank: venue.payoutBankName,
          account: venue.payoutAccountNumber?.slice(-4) ?? null,
        },
        after: {
          subaccountCode,
          bank: input.bankName,
          account: input.accountNumber.slice(-4),
          accountName,
        },
        ip,
      });
    });
    return { subaccountCode, accountName };
  }

  /** Dev-only: completes a mock checkout by delivering a signed webhook, like Paystack would. */
  async completeMock(reference: string, outcome: 'success' | 'failed', channel?: string) {
    const provider = this.provider as PaymentProvider & {
      complete?: (
        r: string,
        o: 'success' | 'failed',
        c?: string,
      ) => { rawBody: Buffer; signature: string };
    };
    if (this.provider.name !== 'mock' || !provider.complete) throw AppError.notFound();
    const { rawBody, signature } = provider.complete(reference, outcome, channel);
    await this.handleWebhook(rawBody, signature);
    return { ok: true };
  }

  async mockCheckoutInfo(reference: string) {
    if (this.provider.name !== 'mock') throw AppError.notFound();
    const payment = await tenancy.runAsSystem(() =>
      this.db.payment.findUnique({ where: { reference }, include: { venue: true } }),
    );
    if (!payment) throw AppError.notFound('Payment');
    const tx = (
      this.provider as PaymentProvider & { transactions?: Map<string, { callbackUrl: string }> }
    ).transactions?.get(reference);
    return {
      reference,
      amountKobo: payment.amountKobo,
      email: payment.email,
      venueName: payment.venue.name,
      status: payment.status,
      callbackUrl: tx?.callbackUrl ?? null,
    };
  }
}
