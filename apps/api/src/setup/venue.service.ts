import { Injectable } from '@nestjs/common';
import type { DbClient } from '@app/db';
import type { VenueSettingsDto, VenueSettingsInput } from '@app/shared';
import { AuditService } from '../common/audit.service';
import { InjectDb } from '../common/db';
import type { StaffPrincipal } from '../common/request';
import { StorageService } from '../storage/storage.service';
import { ImagesService } from './images.service';

type VenueRow = Awaited<ReturnType<DbClient['venue']['findUniqueOrThrow']>>;

export function maskAccount(n: string | null): string | null {
  return n ? `******${n.slice(-4)}` : null;
}

@Injectable()
export class VenueService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly images: ImagesService,
  ) {}

  toDto(v: VenueRow): VenueSettingsDto {
    return {
      id: v.id,
      name: v.name,
      slug: v.slug,
      address: v.address,
      logoUrl: this.storage.publicUrl(v.logoKey),
      status: v.status,
      paymentMode: v.paymentMode,
      vatBps: v.vatBps,
      serviceChargeBps: v.serviceChargeBps,
      pricesIncludeVat: v.pricesIncludeVat,
      payout: {
        configured: Boolean(v.paystackSubaccountCode),
        bankName: v.payoutBankName,
        accountNumberMasked: maskAccount(v.payoutAccountNumber),
        accountName: v.payoutAccountName,
        subaccountCode: v.paystackSubaccountCode,
      },
      onlinePaymentsEnabled: Boolean(v.paystackSubaccountCode),
    };
  }

  async get(venueId: string): Promise<VenueSettingsDto> {
    return this.toDto(await this.db.venue.findUniqueOrThrow({ where: { id: venueId } }));
  }

  async update(
    staff: StaffPrincipal,
    input: VenueSettingsInput,
    ip: string | null,
  ): Promise<VenueSettingsDto> {
    const updated = await this.db.$transaction(async (tx) => {
      const before = await tx.venue.findUniqueOrThrow({ where: { id: staff.venueId } });
      const after = await tx.venue.update({ where: { id: staff.venueId }, data: input });
      const changed = Object.keys(input).filter(
        (k) => before[k as keyof typeof before] !== after[k as keyof typeof after],
      ) as (keyof VenueSettingsInput)[];
      if (changed.length > 0) {
        await this.audit.record(tx, {
          venueId: staff.venueId,
          actor: staff,
          action: 'SETTINGS_CHANGED',
          entityType: 'Venue',
          entityId: staff.venueId,
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k]])),
          ip,
        });
      }
      return after;
    });
    return this.toDto(updated);
  }

  async setLogo(
    staff: StaffPrincipal,
    uploadKey: string,
    ip: string | null,
  ): Promise<VenueSettingsDto> {
    const key = await this.images.process(staff.venueId, uploadKey, 'logos', 256);
    const { before, after } = await this.db.$transaction(async (tx) => {
      const b = await tx.venue.findUniqueOrThrow({ where: { id: staff.venueId } });
      const a = await tx.venue.update({ where: { id: staff.venueId }, data: { logoKey: key } });
      await this.audit.record(tx, {
        venueId: staff.venueId,
        actor: staff,
        action: 'SETTINGS_CHANGED',
        entityType: 'Venue',
        entityId: staff.venueId,
        before: { logoKey: b.logoKey },
        after: { logoKey: key },
        ip,
      });
      return { before: b, after: a };
    });
    await this.images.remove(before.logoKey);
    return this.toDto(after);
  }
}
