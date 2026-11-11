import { Injectable } from '@nestjs/common';
import { tenancy, type DbClient } from '@app/db';
import { businessDayStart, Rooms, SocketEvent, type PlatformVenueDto } from '@app/shared';
import { AuditService } from '../common/audit.service';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import { EventsService } from '../common/events.service';
import type { AdminPrincipal } from '../common/request';
import { ChecklistService } from '../setup/checklist.service';

/** Operator (super-admin) view across all venues. Runs in system tenant context on purpose. */
@Injectable()
export class PlatformService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly checklist: ChecklistService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  async venues(): Promise<PlatformVenueDto[]> {
    const venues = await tenancy.runAsSystem(() =>
      this.db.venue.findMany({
        orderBy: { createdAt: 'desc' },
        include: { staff: { where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, take: 1 } },
      }),
    );
    const start = businessDayStart();
    return Promise.all(
      venues.map((v) =>
        tenancy.runForVenue(v.id, async () => ({
          id: v.id,
          name: v.name,
          slug: v.slug,
          status: v.status,
          createdAt: v.createdAt.toISOString(),
          ownerName: v.staff[0]?.name ?? null,
          ownerEmail: v.staff[0]?.email ?? null,
          checklist: await this.checklist.forCurrentVenue(v.id),
          ordersToday: await this.db.order.count({
            where: { createdAt: { gte: start }, status: { not: 'CANCELLED' } },
          }),
        })),
      ),
    );
  }

  async setStatus(
    admin: AdminPrincipal,
    venueId: string,
    status: 'ACTIVE' | 'SUSPENDED',
    reason: string | null,
  ) {
    return tenancy.runForVenue(venueId, async () => {
      const venue = await this.db.venue.findUnique({ where: { id: venueId } });
      if (!venue) throw AppError.notFound('Venue');
      if (venue.status !== status) {
        await this.db.$transaction(async (tx) => {
          await tx.venue.update({
            where: { id: venueId },
            data: { status, suspendedAt: status === 'SUSPENDED' ? new Date() : null },
          });
          await this.audit.record(tx, {
            venueId,
            actor: admin,
            action: status === 'SUSPENDED' ? 'VENUE_SUSPENDED' : 'VENUE_ACTIVATED',
            entityType: 'Venue',
            entityId: venueId,
            before: { status: venue.status },
            after: { status },
            reason,
          });
        });
        this.events.emit(
          [Rooms.venue(venueId), Rooms.venueMenu(venueId)],
          SocketEvent.VENUE_STATUS_CHANGED,
          { venueId },
        );
      }
      return { id: venueId, status };
    });
  }
}
