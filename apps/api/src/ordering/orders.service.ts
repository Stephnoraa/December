import { HttpStatus, Injectable } from '@nestjs/common';
import { lockRow, Prisma, type DbClient, type DbTx } from '@app/db';
import {
  assertOrderItemTransition,
  canOrderInSession,
  ErrorCode,
  unitPriceWithAddOns,
  type CreateOrderInput,
  type OrderDto,
  type OrderItemStatus,
  type StationQueueDto,
  type StationQueueItemDto,
} from '@app/shared';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import { EventsService, type PendingEvent } from '../common/events.service';
import type { CustomerPrincipal, StaffPrincipal } from '../common/request';
import { CatalogService } from '../setup/catalog.service';
import { notify } from './notify';
import { TabsService } from './tabs.service';

const RECENT_UNAVAILABLE_MS = 10 * 60_000;

type ItemAction = 'accept' | 'unavailable' | 'ready' | 'serve' | 'undo-unavailable';

const ACTION_TARGET: Record<ItemAction, OrderItemStatus> = {
  accept: 'ACCEPTED',
  unavailable: 'UNAVAILABLE',
  ready: 'READY',
  serve: 'SERVED',
  'undo-unavailable': 'SENT',
};

const TIMESTAMP_FIELD: Partial<
  Record<OrderItemStatus, 'acceptedAt' | 'unavailableAt' | 'readyAt' | 'servedAt'>
> = {
  ACCEPTED: 'acceptedAt',
  UNAVAILABLE: 'unavailableAt',
  READY: 'readyAt',
  SERVED: 'servedAt',
};

/** Customer orders, station item actions and the station queue. */
@Injectable()
export class OrdersService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly tabs: TabsService,
    private readonly catalog: CatalogService,
    private readonly events: EventsService,
  ) {}

  /** Places an order from a customer's phone. PREPAY venues hold it until it is paid. */
  async createCustomerOrder(
    customer: CustomerPrincipal,
    input: CreateOrderInput,
  ): Promise<OrderDto> {
    const venue = await this.db.venue.findUniqueOrThrow({ where: { id: customer.venueId } });
    if (venue.status === 'SUSPENDED') {
      throw new AppError(
        ErrorCode.VENUE_SUSPENDED,
        'Ordering is unavailable right now',
        HttpStatus.FORBIDDEN,
      );
    }
    const menuIds = [...new Set(input.items.map((i) => i.menuItemId))];
    const menuItems = await this.db.menuItem.findMany({
      where: { id: { in: menuIds }, archivedAt: null },
      include: { addOns: { where: { archivedAt: null } }, category: { select: { active: true } } },
    });
    const byId = new Map(menuItems.map((m) => [m.id, m]));
    const unavailable = menuIds.filter((id) => {
      const m = byId.get(id);
      return !m || !m.isAvailable || !m.category.active;
    });
    if (unavailable.length > 0) {
      throw AppError.conflict(
        ErrorCode.ITEM_UNAVAILABLE,
        'Some items just sold out. Please review your order.',
        { menuItemIds: unavailable },
      );
    }
    const lines = input.items.map((line) => {
      const m = byId.get(line.menuItemId)!;
      const addOnIds = [...new Set(line.addOnIds)];
      const addOns = addOnIds.map((id) => m.addOns.find((a) => a.id === id));
      if (addOns.some((a) => !a || !a.isAvailable)) {
        throw AppError.conflict(
          ErrorCode.ITEM_UNAVAILABLE,
          `An option for ${m.name} is no longer available`,
          { menuItemIds: [m.id] },
        );
      }
      const chosen = addOns.map((a) => ({
        id: a!.id,
        name: a!.name,
        priceDeltaKobo: a!.priceDeltaKobo,
      }));
      return {
        menuItem: m,
        quantity: line.quantity,
        note: line.note?.trim() || null,
        addOns: chosen,
        unitPriceKobo: unitPriceWithAddOns(
          m.priceKobo,
          chosen.map((a) => a.priceDeltaKobo),
        ),
      };
    });

    const prepay = venue.paymentMode === 'PREPAY';
    const { order, tab } = await this.db.$transaction(async (tx) => {
      const session = await tx.tableSession.findUnique({
        where: { id: customer.tableSessionId },
        include: { tab: true },
      });
      if (!session || !canOrderInSession(session.status) || !session.tab) {
        throw new AppError(
          ErrorCode.TABLE_NOT_OPEN,
          'This table is not open. Please ask your waiter.',
          HttpStatus.CONFLICT,
        );
      }
      await lockRow(tx, 'Tab', session.tab.id, customer.venueId);
      const last = await tx.order.findFirst({
        where: { tabId: session.tab.id },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const now = new Date();
      const created = await tx.order.create({
        data: {
          venueId: customer.venueId,
          tabId: session.tab.id,
          tableSessionId: session.id,
          customerSessionId: customer.customerSessionId,
          number: (last?.number ?? 0) + 1,
          status: prepay ? 'AWAITING_PAYMENT' : 'PLACED',
          placedAt: prepay ? null : now,
          items: {
            create: lines.map((l) => ({
              venueId: customer.venueId,
              tabId: session.tab!.id,
              menuItemId: l.menuItem.id,
              stationId: l.menuItem.stationId,
              name: l.menuItem.name,
              basePriceKobo: l.menuItem.priceKobo,
              addOns: l.addOns as unknown as Prisma.InputJsonValue,
              unitPriceKobo: l.unitPriceKobo,
              quantity: l.quantity,
              note: l.note,
              status: 'SENT' as const,
              sentAt: prepay ? null : now,
            })),
          },
        },
      });
      await tx.customerSession.update({
        where: { id: customer.customerSessionId },
        data: { lastSeenAt: now },
      });
      const t = await this.tabs.recalculate(tx, session.tab.id, customer.venueId);
      return { order: created, tab: t };
    });

    const events: PendingEvent[] = [
      notify.order(customer.venueId, customer.tableSessionId, order.id, order.version, true),
      ...notify.tab(customer.venueId, customer.tableSessionId, tab.id, tab.version),
    ];
    if (order.status === 'PLACED') {
      events.push(
        ...notify.stations(
          customer.venueId,
          lines.map((l) => l.menuItem.stationId),
        ),
      );
    }
    this.events.emitAll(events);
    const orderRow = tab.orders.find((o) => o.id === order.id)!;
    return this.tabs.orderDto(tab, orderRow, { customerSessionId: customer.customerSessionId });
  }

  /**
   * Moves an order item through its lifecycle. The update is conditional on the current status,
   * so two staff tapping at once cannot both succeed.
   */
  async itemAction(
    staff: StaffPrincipal,
    orderItemId: string,
    action: ItemAction,
    opts: { disableMenuItem?: boolean; ip?: string | null } = {},
  ) {
    const to = ACTION_TARGET[action];
    const result = await this.db.$transaction(async (tx) => {
      const item = await tx.orderItem.findUnique({
        where: { id: orderItemId },
        include: { order: true },
      });
      if (!item) throw AppError.notFound('Order item');
      if (item.order.status !== 'PLACED') {
        throw AppError.conflict(
          ErrorCode.INVALID_TRANSITION,
          'This order has not been sent to the stations',
        );
      }
      assertOrderItemTransition(item.status, to);
      const stamp = TIMESTAMP_FIELD[to];
      const updated = await tx.orderItem.updateMany({
        where: { id: item.id, status: item.status },
        data: {
          status: to,
          version: { increment: 1 },
          actedByStaffId: staff.staffId,
          ...(stamp ? { [stamp]: new Date() } : {}),
          ...(action === 'undo-unavailable' ? { unavailableAt: null } : {}),
        },
      });
      if (updated.count !== 1)
        throw AppError.conflict(
          ErrorCode.INVALID_TRANSITION,
          'Someone else just updated this item',
        );
      let menuChanged = false;
      if (action === 'unavailable' && opts.disableMenuItem !== false) {
        menuChanged = await this.catalog.setAvailabilityTx(
          tx,
          staff,
          item.menuItemId,
          false,
          opts.ip ?? null,
        );
      }
      if (action === 'undo-unavailable') {
        menuChanged = await this.catalog.setAvailabilityTx(
          tx,
          staff,
          item.menuItemId,
          true,
          opts.ip ?? null,
        );
      }
      const billingChanged = action === 'unavailable' || action === 'undo-unavailable';
      const tab = billingChanged
        ? await this.tabs.recalculate(tx, item.tabId, staff.venueId)
        : await tx.tab.update({ where: { id: item.tabId }, data: { version: { increment: 1 } } });
      return { item, version: item.version + 1, tabVersion: tab.version, menuChanged };
    });
    const { item } = result;
    this.events.emitAll([
      notify.item(staff.venueId, item.order.tableSessionId, item.id, result.version),
      ...notify.tab(staff.venueId, item.order.tableSessionId, item.tabId, result.tabVersion),
      ...notify.stations(staff.venueId, [item.stationId]),
    ]);
    if (result.menuChanged) this.catalog.menuChanged(staff.venueId, item.menuItemId);
    return { id: item.id, status: to, version: result.version };
  }

  private queueItem(
    i: Prisma.OrderItemGetPayload<{
      include: { order: { include: { tableSession: { include: { table: true } } } } };
    }>,
  ): StationQueueItemDto {
    return {
      id: i.id,
      orderId: i.orderId,
      orderNumber: i.order.number,
      tableId: i.order.tableSession.tableId,
      tableLabel: i.order.tableSession.table.label,
      tableArea: i.order.tableSession.table.area,
      name: i.name,
      addOns: ((i.addOns as { name: string }[]) ?? []).map((a) => ({ name: a.name })),
      quantity: i.quantity,
      note: i.note,
      status: i.status,
      menuItemId: i.menuItemId,
      orderedAt: (i.sentAt ?? i.createdAt).toISOString(),
      version: i.version,
    };
  }

  async stationQueue(stationId: string): Promise<StationQueueDto> {
    const station = await this.db.station.findUnique({ where: { id: stationId } });
    if (!station) throw AppError.notFound('Station');
    const include = { order: { include: { tableSession: { include: { table: true } } } } } as const;
    const [active, recent] = await Promise.all([
      this.db.orderItem.findMany({
        where: { stationId, status: { in: ['SENT', 'ACCEPTED'] }, order: { status: 'PLACED' } },
        include,
        orderBy: [{ sentAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.db.orderItem.findMany({
        where: {
          stationId,
          status: 'UNAVAILABLE',
          unavailableAt: { gt: new Date(Date.now() - RECENT_UNAVAILABLE_MS) },
        },
        include,
        orderBy: { unavailableAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      station: {
        id: station.id,
        name: station.name,
        sortOrder: station.sortOrder,
        active: station.active,
      },
      items: active.map((i) => this.queueItem(i)),
      recentlyUnavailable: recent.map((i) => this.queueItem(i)),
    };
  }

  /** Used by payments: releases a paid PREPAY order to the stations. */
  async releaseOrderTx(
    tx: DbTx,
    orderId: string,
  ): Promise<{ released: boolean; stationIds: string[] }> {
    const now = new Date();
    const res = await tx.order.updateMany({
      where: { id: orderId, status: 'AWAITING_PAYMENT' },
      data: { status: 'PLACED', placedAt: now, version: { increment: 1 } },
    });
    if (res.count === 0) return { released: false, stationIds: [] };
    await tx.orderItem.updateMany({ where: { orderId }, data: { sentAt: now } });
    const items = await tx.orderItem.findMany({ where: { orderId }, select: { stationId: true } });
    return { released: true, stationIds: items.map((i) => i.stationId) };
  }
}
