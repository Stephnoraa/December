import { Injectable } from '@nestjs/common';
import { lockRow, type DbTx, type Prisma } from '@app/db';
import {
  calculateTab,
  deriveTabStatus,
  isBillableItemStatus,
  paymentBucket,
  tabBalance,
  type AdjustmentDto,
  type OrderDto,
  type OrderItemDto,
  type PaymentDto,
  type TabDto,
  type TabLineInput,
  type TabTotals,
  type TabTotalsDto,
} from '@app/shared';
import { AppError } from '../common/errors';

export const TAB_INCLUDE = {
  orders: { orderBy: { number: 'asc' }, include: { items: { orderBy: { createdAt: 'asc' } } } },
  payments: { orderBy: { createdAt: 'asc' } },
  adjustments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TabInclude;

export type TabWithRelations = Prisma.TabGetPayload<{ include: typeof TAB_INCLUDE }>;
type ItemRow = TabWithRelations['orders'][number]['items'][number];
type OrderRow = TabWithRelations['orders'][number];

/** A line counts towards the bill when its order is placed and the item is not unavailable/voided. */
export function lineBillable(
  order: { status: string },
  item: { status: ItemRow['status'] },
): boolean {
  return order.status === 'PLACED' && isBillableItemStatus(item.status);
}

export function tabLines(
  orders: { status: string; items: ItemRow[] }[],
  treatAsPlaced?: string,
): TabLineInput[] {
  return orders.flatMap((o) =>
    o.items.map((i) => ({
      id: i.id,
      unitPriceKobo: i.unitPriceKobo,
      quantity: i.quantity,
      billable: lineBillable(
        treatAsPlaced && i.orderId === treatAsPlaced ? { status: 'PLACED' } : o,
        i,
      ),
    })),
  );
}

export function tabDiscounts(adjustments: TabWithRelations['adjustments']) {
  return adjustments
    .filter((a) => a.type === 'DISCOUNT')
    .map((a) => ({
      id: a.id,
      kind: a.discountKind ?? 'AMOUNT',
      amountKobo: a.amountKobo,
      percentBps: a.percentBps,
      orderItemId: a.orderItemId,
    }));
}

function settings(tab: { vatBps: number; serviceChargeBps: number; pricesIncludeVat: boolean }) {
  return {
    vatBps: tab.vatBps,
    serviceChargeBps: tab.serviceChargeBps,
    pricesIncludeVat: tab.pricesIncludeVat,
  };
}

export function computeTotals(tab: TabWithRelations): TabTotals {
  return calculateTab(tabLines(tab.orders), tabDiscounts(tab.adjustments), settings(tab));
}

/** PREPAY: what releasing this order adds to the tab total (exact, so balances end at zero). */
export function prepayAmountDue(tab: TabWithRelations, orderId: string): number {
  const without = calculateTab(
    tabLines(tab.orders),
    tabDiscounts(tab.adjustments),
    settings(tab),
  ).totalKobo;
  const withOrder = calculateTab(
    tabLines(tab.orders, orderId),
    tabDiscounts(tab.adjustments),
    settings(tab),
  ).totalKobo;
  return Math.max(0, withOrder - without);
}

export function paidKobo(tab: Pick<TabWithRelations, 'payments'>): number {
  return tab.payments
    .filter((p) => p.status === 'SUCCESS')
    .reduce((sum, p) => sum + p.amountKobo, 0);
}

export interface TabViewer {
  customerSessionId?: string;
}

@Injectable()
export class TabsService {
  async load(tx: DbTx, tabId: string): Promise<TabWithRelations> {
    const tab = await tx.tab.findUnique({ where: { id: tabId }, include: TAB_INCLUDE });
    if (!tab) throw AppError.notFound('Tab');
    return tab;
  }

  /**
   * Recomputes and caches the tab totals, status and version. Locks the tab row, so call it
   * inside the same transaction as the change that affects the bill.
   */
  async recalculate(tx: DbTx, tabId: string, venueId: string): Promise<TabWithRelations> {
    await lockRow(tx, 'Tab', tabId, venueId);
    const tab = await this.load(tx, tabId);
    const totals = computeTotals(tab);
    const paid = paidKobo(tab);
    const balance = tabBalance(totals.totalKobo, paid);
    const status = deriveTabStatus(tab.status, totals.totalKobo, paid);
    const updated = await tx.tab.update({
      where: { id: tabId },
      data: {
        subtotalKobo: totals.subtotalKobo,
        discountKobo: totals.discountKobo,
        serviceChargeKobo: totals.serviceChargeKobo,
        vatKobo: totals.vatKobo,
        vatIncludedKobo: totals.vatIncludedKobo,
        totalKobo: totals.totalKobo,
        paidKobo: paid,
        balanceKobo: balance.balanceKobo,
        overpaidKobo: balance.overpaidKobo,
        status,
        paidAt: status === 'PAID' ? (tab.paidAt ?? new Date()) : null,
        // Version always moves so clients refetch after any item/order change.
        version: { increment: 1 },
      },
      include: TAB_INCLUDE,
    });
    return updated;
  }

  totalsDto(tab: TabWithRelations): TabTotalsDto {
    return {
      subtotalKobo: tab.subtotalKobo,
      discountKobo: tab.discountKobo,
      serviceChargeKobo: tab.serviceChargeKobo,
      vatKobo: tab.vatKobo,
      vatIncludedKobo: tab.vatIncludedKobo,
      totalKobo: tab.totalKobo,
      paidKobo: tab.paidKobo,
      balanceKobo: tab.balanceKobo,
      overpaidKobo: tab.overpaidKobo,
      pricesIncludeVat: tab.pricesIncludeVat,
      vatBps: tab.vatBps,
      serviceChargeBps: tab.serviceChargeBps,
    };
  }

  itemDto(order: OrderRow, i: ItemRow): OrderItemDto {
    return {
      id: i.id,
      orderId: i.orderId,
      menuItemId: i.menuItemId,
      stationId: i.stationId,
      name: i.name,
      addOns: (i.addOns as { id: string; name: string; priceDeltaKobo: number }[]) ?? [],
      unitPriceKobo: i.unitPriceKobo,
      quantity: i.quantity,
      lineTotalKobo: i.unitPriceKobo * i.quantity,
      note: i.note,
      status: i.status,
      billable: lineBillable(order, i),
      version: i.version,
      createdAt: i.createdAt.toISOString(),
      sentAt: i.sentAt?.toISOString() ?? null,
      acceptedAt: i.acceptedAt?.toISOString() ?? null,
      readyAt: i.readyAt?.toISOString() ?? null,
      servedAt: i.servedAt?.toISOString() ?? null,
    };
  }

  orderDto(tab: TabWithRelations, o: OrderRow, viewer: TabViewer): OrderDto {
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      version: o.version,
      createdAt: o.createdAt.toISOString(),
      mine: Boolean(viewer.customerSessionId && o.customerSessionId === viewer.customerSessionId),
      byStaff: !o.customerSessionId,
      amountDueKobo: o.status === 'AWAITING_PAYMENT' ? prepayAmountDue(tab, o.id) : null,
      items: o.items.map((i) => this.itemDto(o, i)),
    };
  }

  paymentDto(p: TabWithRelations['payments'][number], viewer: TabViewer): PaymentDto {
    return {
      id: p.id,
      reference: p.reference,
      amountKobo: p.amountKobo,
      method: p.method,
      channel: p.channel,
      bucket: paymentBucket(p.method, p.channel),
      status: p.status,
      orderId: p.orderId,
      overpaidKobo: p.overpaidKobo,
      createdAt: p.createdAt.toISOString(),
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      mine: Boolean(viewer.customerSessionId && p.customerSessionId === viewer.customerSessionId),
    };
  }

  adjustmentDtos(tab: TabWithRelations, names: Map<string, string>): AdjustmentDto[] {
    const applied = new Map(computeTotals(tab).discounts.map((d) => [d.id, d.appliedKobo]));
    return tab.adjustments.map((a) => ({
      id: a.id,
      type: a.type,
      discountKind: a.discountKind,
      amountKobo: a.amountKobo,
      percentBps: a.percentBps,
      appliedKobo: a.type === 'VOID' ? (a.amountKobo ?? 0) : (applied.get(a.id) ?? 0),
      orderItemId: a.orderItemId,
      reason: a.reason,
      requestedBy: { id: a.requestedByStaffId, name: names.get(a.requestedByStaffId) ?? 'Staff' },
      approvedBy: { id: a.approvedByStaffId, name: names.get(a.approvedByStaffId) ?? 'Manager' },
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async staffNames(tx: DbTx, tab: TabWithRelations): Promise<Map<string, string>> {
    const ids = [
      ...new Set(tab.adjustments.flatMap((a) => [a.requestedByStaffId, a.approvedByStaffId])),
    ];
    if (ids.length === 0) return new Map();
    const staff = await tx.staffMember.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(staff.map((s) => [s.id, s.name]));
  }

  async tabDto(tx: DbTx, tab: TabWithRelations, viewer: TabViewer = {}): Promise<TabDto> {
    const names = await this.staffNames(tx, tab);
    return {
      id: tab.id,
      status: tab.status,
      version: tab.version,
      receiptToken: tab.receiptToken,
      totals: this.totalsDto(tab),
      orders: tab.orders
        .filter((o) => o.status !== 'CANCELLED')
        .map((o) => this.orderDto(tab, o, viewer)),
      payments: tab.payments
        .filter((p) => p.status !== 'FAILED')
        .map((p) => this.paymentDto(p, viewer)),
      adjustments: this.adjustmentDtos(tab, names),
    };
  }
}
