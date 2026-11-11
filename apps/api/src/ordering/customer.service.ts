import { HttpStatus, Injectable } from '@nestjs/common';
import { type DbClient } from '@app/db';
import { ErrorCode, type CustomerSessionDto, type TableLandingDto } from '@app/shared';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import type { CustomerPrincipal } from '../common/request';
import { PublicMenuService, type ResolvedTable } from './public-menu.service';
import { TabsService } from './tabs.service';

@Injectable()
export class CustomerService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly menu: PublicMenuService,
    private readonly tabs: TabsService,
  ) {}

  liveSession(tableId: string) {
    return this.db.tableSession.findFirst({ where: { tableId, status: 'OPEN' } });
  }

  async landing(
    resolved: ResolvedTable,
    current: CustomerPrincipal | null,
  ): Promise<TableLandingDto> {
    const [session, menu] = await Promise.all([
      this.liveSession(resolved.table.id),
      this.menu.menu(),
    ]);
    return {
      venue: this.menu.venueDto(resolved.venue),
      table: resolved.table,
      open: Boolean(session),
      joined: Boolean(session && current && current.tableSessionId === session.id),
      menu,
    };
  }

  /**
   * Joins the open session for this table: reuses the device's customer session when it is
   * already in this session (rescan), otherwise creates a new anonymous one.
   */
  async join(
    resolved: ResolvedTable,
    current: CustomerPrincipal | null,
  ): Promise<{ customerSessionId: string; tableSessionId: string }> {
    const session = await this.liveSession(resolved.table.id);
    if (!session) {
      throw new AppError(
        ErrorCode.TABLE_NOT_OPEN,
        'Ask your waiter to open this table to start ordering.',
        HttpStatus.CONFLICT,
      );
    }
    if (current && current.tableSessionId === session.id) {
      await this.db.customerSession.update({
        where: { id: current.customerSessionId },
        data: { lastSeenAt: new Date() },
      });
      return { customerSessionId: current.customerSessionId, tableSessionId: session.id };
    }
    const cs = await this.db.customerSession.create({
      data: { venueId: resolved.venue.id, tableSessionId: session.id },
    });
    return { customerSessionId: cs.id, tableSessionId: session.id };
  }

  async session(customer: CustomerPrincipal): Promise<CustomerSessionDto> {
    const session = await this.db.tableSession.findUnique({
      where: { id: customer.tableSessionId },
      include: {
        table: true,
        venue: true,
        tab: true,
        serviceRequests: { where: { status: 'OPEN' } },
      },
    });
    if (!session || !session.tab)
      throw AppError.unauthenticated('Scan the QR code on your table to continue');
    const [tab, menu] = await Promise.all([
      this.tabs.load(this.db, session.tab.id),
      this.menu.menu(),
    ]);
    return {
      venue: this.menu.venueDto(session.venue),
      table: { id: session.table.id, label: session.table.label, area: session.table.area },
      tableSession: {
        id: session.id,
        status: session.status,
        openedAt: session.openedAt.toISOString(),
        closedAt: session.closedAt?.toISOString() ?? null,
      },
      tab: await this.tabs.tabDto(this.db, tab, { customerSessionId: customer.customerSessionId }),
      openRequests: session.serviceRequests.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      menu,
    };
  }
}
