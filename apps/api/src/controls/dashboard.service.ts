import { Injectable } from '@nestjs/common';
import type { DbClient } from '@app/db';
import {
  businessDayStart,
  paymentBucket,
  type AuditEventDto,
  type AuditPageDto,
  type DashboardDto,
  type PaymentBucket,
} from '@app/shared';
import { InjectDb } from '../common/db';
import { computeTotals, TabsService } from '../ordering/tabs.service';

@Injectable()
export class DashboardService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly tabs: TabsService,
  ) {}

  async dashboard(now = new Date()): Promise<DashboardDto> {
    const start = businessDayStart(now);
    const [payments, openSessions, adjustments, overpaidTabs] = await Promise.all([
      this.db.payment.findMany({ where: { status: 'SUCCESS', verifiedAt: { gte: start } } }),
      this.db.tableSession.findMany({
        where: { status: 'OPEN' },
        include: { tab: true, table: true },
        orderBy: { openedAt: 'asc' },
      }),
      this.db.adjustment.findMany({
        where: { createdAt: { gte: start } },
        orderBy: { createdAt: 'desc' },
        include: { tab: { include: { tableSession: { include: { table: true } } } } },
      }),
      this.db.tab.findMany({
        where: {
          overpaidKobo: { gt: 0 },
          updatedAt: { gte: new Date(start.getTime() - 7 * 86_400_000) },
        },
        include: {
          tableSession: { include: { table: true } },
          payments: { where: { status: 'SUCCESS' }, orderBy: { createdAt: 'desc' } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    const byBucket: Record<PaymentBucket, number> = {
      CARD: 0,
      TRANSFER: 0,
      USSD: 0,
      OTHER_ONLINE: 0,
      CASH: 0,
      POS: 0,
    };
    for (const p of payments) byBucket[paymentBucket(p.method, p.channel)] += p.amountKobo;
    const staffIds = [
      ...new Set(adjustments.flatMap((a) => [a.requestedByStaffId, a.approvedByStaffId])),
    ];
    const names = new Map(
      (
        await this.db.staffMember.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, name: true },
        })
      ).map((s) => [s.id, s.name]),
    );
    // Exact applied discount amounts come from the same calculation as the bill.
    const applied = new Map<string, number>();
    for (const tabId of new Set(
      adjustments.filter((a) => a.type === 'DISCOUNT').map((a) => a.tabId),
    )) {
      for (const d of computeTotals(await this.tabs.load(this.db, tabId)).discounts)
        applied.set(d.id, d.appliedKobo);
    }
    const openTabs = openSessions
      .filter((s) => s.tab)
      .map((s) => ({
        tabId: s.tab!.id,
        tableSessionId: s.id,
        tableLabel: s.table.label,
        area: s.table.area,
        openedAt: s.openedAt.toISOString(),
        totalKobo: s.tab!.totalKobo,
        paidKobo: s.tab!.paidKobo,
        balanceKobo: s.tab!.balanceKobo,
      }));
    return {
      businessDayStart: start.toISOString(),
      salesTodayKobo: payments.reduce((s, p) => s + p.amountKobo, 0),
      paymentsToday: payments.length,
      byBucket,
      openTabs,
      openTabsBalanceKobo: openTabs.reduce((s, t) => s + t.balanceKobo, 0),
      adjustmentsToday: adjustments.map((a) => ({
        id: a.id,
        type: a.type,
        discountKind: a.discountKind,
        amountKobo: a.amountKobo,
        percentBps: a.percentBps,
        appliedKobo: a.type === 'VOID' ? (a.amountKobo ?? 0) : (applied.get(a.id) ?? 0),
        orderItemId: a.orderItemId,
        reason: `${a.reason} · Table ${a.tab.tableSession.table.label}`,
        requestedBy: { id: a.requestedByStaffId, name: names.get(a.requestedByStaffId) ?? 'Staff' },
        approvedBy: { id: a.approvedByStaffId, name: names.get(a.approvedByStaffId) ?? 'Manager' },
        createdAt: a.createdAt.toISOString(),
      })),
      refundsDue: overpaidTabs.map((t) => ({
        paymentId: t.payments[0]?.id ?? t.id,
        reference: t.payments[0]?.reference ?? '',
        tableLabel: t.tableSession.table.label,
        overpaidKobo: t.overpaidKobo,
        createdAt: t.updatedAt.toISOString(),
      })),
    };
  }

  async audit(query: { cursor?: string; limit: number; action?: string }): Promise<AuditPageDto> {
    const rows = await this.db.auditEvent.findMany({
      where: query.action ? { action: query.action } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    const ids = [
      ...new Set(
        page
          .flatMap((e) => [e.actorType === 'STAFF' ? e.actorId : null, e.approverId])
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    const names = new Map(
      (
        await this.db.staffMember.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((s) => [s.id, s.name]),
    );
    const events: AuditEventDto[] = page.map((e) => ({
      id: e.id,
      action: e.action,
      actorType: e.actorType,
      actorName:
        e.actorType === 'STAFF' && e.actorId
          ? (names.get(e.actorId) ?? null)
          : e.actorType === 'SYSTEM'
            ? 'System'
            : e.actorType === 'PLATFORM_ADMIN'
              ? 'Platform operator'
              : e.actorType === 'CUSTOMER'
                ? 'Customer'
                : null,
      approverName: e.approverId ? (names.get(e.approverId) ?? null) : null,
      entityType: e.entityType,
      entityId: e.entityId,
      before: e.before,
      after: e.after,
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    }));
    return {
      events,
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
