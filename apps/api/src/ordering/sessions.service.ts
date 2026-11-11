import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { lockRow, Prisma, type DbClient } from '@app/db';
import {
  assertTableSessionTransition,
  ErrorCode,
  type FloorDto,
  type FloorTableDto,
  type ServiceRequestDto,
  type ServiceRequestType,
  type StaffTabDto,
} from '@app/shared';
import { AuditService } from '../common/audit.service';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import { EventsService, type PendingEvent } from '../common/events.service';
import type { CustomerPrincipal, StaffPrincipal } from '../common/request';
import { sortTables } from '../setup/tables.service';
import { notify } from './notify';
import { TabsService } from './tabs.service';

const CALL_WAITER_DEDUPE_MS = 2 * 60_000;

function requestDto(r: {
  id: string;
  type: ServiceRequestType;
  status: 'OPEN' | 'ACKNOWLEDGED';
  createdAt: Date;
}): ServiceRequestDto {
  return { id: r.id, type: r.type, status: r.status, createdAt: r.createdAt.toISOString() };
}

/** Table sessions (open/close), the waiter floor, service requests. */
@Injectable()
export class SessionsService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly tabs: TabsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /** A waiter opens a table: creates the session and its tab (charges snapshotted). */
  async open(staff: StaffPrincipal, tableId: string, ip: string | null) {
    const venue = await this.db.venue.findUniqueOrThrow({ where: { id: staff.venueId } });
    if (venue.status === 'SUSPENDED') {
      throw new AppError(
        ErrorCode.VENUE_SUSPENDED,
        'This venue is suspended',
        HttpStatus.FORBIDDEN,
      );
    }
    const table = await this.db.table.findUnique({ where: { id: tableId } });
    if (!table || !table.active) throw AppError.notFound('Table');
    let session;
    try {
      session = await this.db.$transaction(async (tx) => {
        const s = await tx.tableSession.create({
          data: { venueId: staff.venueId, tableId, status: 'OPEN', openedByStaffId: staff.staffId },
        });
        await tx.tab.create({
          data: {
            venueId: staff.venueId,
            tableSessionId: s.id,
            vatBps: venue.vatBps,
            serviceChargeBps: venue.serviceChargeBps,
            pricesIncludeVat: venue.pricesIncludeVat,
            receiptToken: randomBytes(18).toString('base64url'),
          },
        });
        // Any "call waiter" from before the table was open now belongs to this session.
        await tx.serviceRequest.updateMany({
          where: { tableId, tableSessionId: null, status: 'OPEN' },
          data: { tableSessionId: s.id },
        });
        await this.audit.record(tx, {
          venueId: staff.venueId,
          actor: staff,
          action: 'TABLE_OPENED',
          entityType: 'TableSession',
          entityId: s.id,
          after: { table: table.label },
          ip,
        });
        return s;
      });
    } catch (err) {
      // Partial unique index: one live session per table.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AppError.conflict(
          ErrorCode.TABLE_ALREADY_OPEN,
          `Table ${table.label} is already open`,
        );
      }
      throw err;
    }
    this.events.emitAll(notify.tableSession(staff.venueId, tableId, session.id, true));
    return { tableSessionId: session.id };
  }

  /** Closes a table once nothing is owed. Unpaid PREPAY orders are cancelled. */
  async close(staff: StaffPrincipal, tableSessionId: string, ip: string | null) {
    const result = await this.db.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'TableSession', tableSessionId, staff.venueId)))
        throw AppError.notFound('Table session');
      const session = await tx.tableSession.findUniqueOrThrow({
        where: { id: tableSessionId },
        include: { tab: true, table: true },
      });
      assertTableSessionTransition(session.status, 'CLOSED');
      const tab = session.tab!;
      await tx.order.updateMany({
        where: { tabId: tab.id, status: 'AWAITING_PAYMENT' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), version: { increment: 1 } },
      });
      const recalculated = await this.tabs.recalculate(tx, tab.id, staff.venueId);
      if (recalculated.balanceKobo > 0) {
        throw AppError.conflict(
          ErrorCode.TAB_HAS_BALANCE,
          'This table still owes money. Record the payment before closing.',
          {
            balanceKobo: recalculated.balanceKobo,
          },
        );
      }
      const now = new Date();
      await tx.tab.update({
        where: { id: tab.id },
        data: { status: 'CLOSED', closedAt: now, version: { increment: 1 } },
      });
      await tx.tableSession.update({
        where: { id: tableSessionId },
        data: { status: 'CLOSED', closedAt: now, closedByStaffId: staff.staffId },
      });
      await tx.serviceRequest.updateMany({
        where: { tableSessionId, status: 'OPEN' },
        data: { status: 'ACKNOWLEDGED', acknowledgedAt: now, acknowledgedByStaffId: staff.staffId },
      });
      await this.audit.record(tx, {
        venueId: staff.venueId,
        actor: staff,
        action: 'TABLE_CLOSED',
        entityType: 'TableSession',
        entityId: tableSessionId,
        after: {
          table: session.table.label,
          totalKobo: recalculated.totalKobo,
          paidKobo: recalculated.paidKobo,
          overpaidKobo: recalculated.overpaidKobo,
        },
        ip,
      });
      return { tableId: session.tableId, tabId: tab.id, version: recalculated.version + 1 };
    });
    this.events.emitAll([
      ...notify.tableSession(staff.venueId, result.tableId, tableSessionId, false),
      ...notify.tab(staff.venueId, tableSessionId, result.tabId, result.version),
    ]);
    return { ok: true as const };
  }

  async floor(): Promise<FloorDto> {
    const [tables, requests] = await Promise.all([
      this.db.table.findMany({
        where: { active: true },
        include: {
          sessions: {
            where: { status: { not: 'CLOSED' } },
            include: {
              tab: true,
              orders: { where: { status: { not: 'CANCELLED' } }, include: { items: true } },
            },
          },
        },
      }),
      this.db.serviceRequest.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' } }),
    ]);
    const readyItems: FloorDto['readyItems'] = [];
    const rows: FloorTableDto[] = sortTables(tables).map((t) => {
      const session = t.sessions[0] ?? null;
      const items =
        session?.orders.filter((o) => o.status === 'PLACED').flatMap((o) => o.items) ?? [];
      for (const i of items.filter((x) => x.status === 'READY')) {
        readyItems.push({
          id: i.id,
          tableLabel: t.label,
          tableId: t.id,
          name: i.name,
          quantity: i.quantity,
          readyAt: (i.readyAt ?? i.updatedAt).toISOString(),
        });
      }
      const open = requests.filter((r) => r.tableId === t.id);
      return {
        id: t.id,
        label: t.label,
        area: t.area,
        state: session ? 'OPEN' : 'CLOSED',
        tableSessionId: session?.id ?? null,
        tabId: session?.tab?.id ?? null,
        openedAt: session?.openedAt.toISOString() ?? null,
        itemsReady: items.filter((i) => i.status === 'READY').length,
        itemsPending: items.filter((i) => i.status === 'SENT' || i.status === 'ACCEPTED').length,
        waiterCalled: open.some((r) => r.type === 'CALL_WAITER'),
        billRequested: open.some((r) => r.type === 'REQUEST_BILL'),
        totalKobo: session?.tab?.totalKobo ?? 0,
        balanceKobo: session?.tab?.balanceKobo ?? 0,
        tabStatus: session?.tab?.status ?? null,
        awaitingPaymentOrders:
          session?.orders.filter((o) => o.status === 'AWAITING_PAYMENT').length ?? 0,
        version: session?.tab?.version ?? 0,
        openRequests: open.map((r) => ({ ...requestDto(r), tableSessionId: r.tableSessionId })),
      };
    });
    readyItems.sort((a, b) => a.readyAt.localeCompare(b.readyAt));
    return { tables: rows, readyItems };
  }

  async staffTab(tableSessionId: string): Promise<StaffTabDto> {
    const session = await this.db.tableSession.findUnique({
      where: { id: tableSessionId },
      include: {
        table: true,
        tab: true,
        serviceRequests: { where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session || !session.tab) throw AppError.notFound('Table session');
    const tab = await this.tabs.load(this.db, session.tab.id);
    const opener = session.openedByStaffId
      ? await this.db.staffMember.findUnique({
          where: { id: session.openedByStaffId },
          select: { name: true },
        })
      : null;
    const now = Date.now();
    const pendingOnlineKobo = tab.payments
      .filter(
        (p) =>
          p.status === 'PENDING' &&
          p.method === 'PAYSTACK' &&
          (!p.reservedUntil || p.reservedUntil.getTime() > now),
      )
      .reduce((s, p) => s + p.amountKobo, 0);
    return {
      table: { id: session.table.id, label: session.table.label, area: session.table.area },
      tableSession: {
        id: session.id,
        status: session.status,
        openedAt: session.openedAt.toISOString(),
        closedAt: session.closedAt?.toISOString() ?? null,
        openedBy: opener?.name ?? null,
      },
      tab: await this.tabs.tabDto(this.db, tab),
      openRequests: session.serviceRequests.map(requestDto),
      pendingOnlineKobo,
    };
  }

  /** Customer "Call waiter" / "Request bill". Works before the table is opened (call waiter only). */
  async request(
    target: { venueId: string; tableId: string; tableSessionId: string | null },
    type: ServiceRequestType,
    _actor: CustomerPrincipal | null,
  ): Promise<ServiceRequestDto> {
    if (type === 'REQUEST_BILL' && !target.tableSessionId) {
      throw new AppError(
        ErrorCode.TABLE_NOT_OPEN,
        'This table is not open yet',
        HttpStatus.CONFLICT,
      );
    }
    // Repeated taps within a short window reuse the open request instead of spamming staff.
    const recent = await this.db.serviceRequest.findFirst({
      where: {
        tableId: target.tableId,
        type,
        status: 'OPEN',
        createdAt: { gt: new Date(Date.now() - CALL_WAITER_DEDUPE_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return requestDto(recent);
    const created = await this.db.serviceRequest.create({
      data: {
        venueId: target.venueId,
        tableId: target.tableId,
        tableSessionId: target.tableSessionId,
        type,
      },
    });
    this.events.emitAll(
      notify.serviceRequest(target.venueId, target.tableSessionId, target.tableId),
    );
    return requestDto(created);
  }

  async acknowledge(staff: StaffPrincipal, id: string): Promise<ServiceRequestDto> {
    const req = await this.db.serviceRequest.findUnique({ where: { id } });
    if (!req) throw AppError.notFound('Request');
    const updated =
      req.status === 'OPEN'
        ? await this.db.serviceRequest.update({
            where: { id },
            data: {
              status: 'ACKNOWLEDGED',
              acknowledgedAt: new Date(),
              acknowledgedByStaffId: staff.staffId,
            },
          })
        : req;
    const events: PendingEvent[] = notify.serviceRequest(
      staff.venueId,
      req.tableSessionId,
      req.tableId,
    );
    this.events.emitAll(events);
    return requestDto(updated);
  }
}
