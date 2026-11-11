import { HttpStatus, Injectable } from '@nestjs/common';
import { tenancy, type DbClient } from '@app/db';
import { ErrorCode, type PublicMenuCategoryDto, type PublicVenueDto } from '@app/shared';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import { QrTokenService } from '../qr/qr-token.service';
import { StorageService } from '../storage/storage.service';

type VenueRow = Awaited<ReturnType<DbClient['venue']['findUniqueOrThrow']>>;

export interface ResolvedTable {
  venue: VenueRow;
  table: { id: string; label: string; area: string | null };
}

@Injectable()
export class PublicMenuService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly qr: QrTokenService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Validates a QR link (signature, venue slug, table active, current QR version) and binds the
   * request to that venue. Throws INVALID_TABLE_TOKEN or VENUE_SUSPENDED.
   */
  async resolveTable(
    venueSlug: string,
    token: string,
    opts: { bind?: boolean } = {},
  ): Promise<ResolvedTable> {
    const invalid = () =>
      new AppError(
        ErrorCode.INVALID_TABLE_TOKEN,
        'This QR code is not valid any more. Please ask your waiter.',
        HttpStatus.NOT_FOUND,
      );
    const payload = this.qr.verify(token);
    if (!payload) throw invalid();
    const found = await tenancy.runAsSystem(() =>
      this.db.table.findUnique({ where: { id: payload.tableId }, include: { venue: true } }),
    );
    if (!found || found.venueId !== payload.venueId || found.venue.slug !== venueSlug)
      throw invalid();
    if (!found.active || found.qrVersion !== payload.version) throw invalid();
    if (found.venue.status === 'SUSPENDED') {
      throw new AppError(
        ErrorCode.VENUE_SUSPENDED,
        `Ordering at ${found.venue.name} is unavailable right now.`,
        HttpStatus.FORBIDDEN,
        {
          venueName: found.venue.name,
        },
      );
    }
    if (opts.bind !== false) tenancy.bindVenue(found.venueId);
    return { venue: found.venue, table: { id: found.id, label: found.label, area: found.area } };
  }

  venueDto(v: VenueRow): PublicVenueDto {
    return {
      id: v.id,
      name: v.name,
      slug: v.slug,
      logoUrl: this.storage.publicUrl(v.logoKey),
      paymentMode: v.paymentMode,
      onlinePaymentsEnabled: Boolean(v.paystackSubaccountCode),
      pricesIncludeVat: v.pricesIncludeVat,
      vatBps: v.vatBps,
      serviceChargeBps: v.serviceChargeBps,
    };
  }

  /** Customer-facing menu: active categories, non-archived items (sold-out items shown greyed). */
  async menu(): Promise<PublicMenuCategoryDto[]> {
    const categories = await this.db.menuCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        items: {
          where: { archivedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            addOns: {
              where: { archivedAt: null },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
    });
    return categories
      .filter((c) => c.items.length > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        items: c.items.map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          priceKobo: i.priceKobo,
          imageUrl: this.storage.publicUrl(i.imageKey),
          isAvailable: i.isAvailable,
          addOns: i.addOns.map((a) => ({
            id: a.id,
            name: a.name,
            priceDeltaKobo: a.priceDeltaKobo,
            isAvailable: a.isAvailable,
          })),
        })),
      }));
  }
}
