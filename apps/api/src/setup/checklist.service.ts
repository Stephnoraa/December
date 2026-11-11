import { Injectable } from '@nestjs/common';
import type { DbClient } from '@app/db';
import type { ChecklistDto, ChecklistItemDto } from '@app/shared';
import { InjectDb } from '../common/db';

@Injectable()
export class ChecklistService {
  constructor(@InjectDb() private readonly db: DbClient) {}

  /** Setup checklist for the current venue (call inside the venue's tenant context). */
  async forCurrentVenue(venueId: string): Promise<ChecklistDto> {
    const [venue, stations, tables, items, waiters, stationStaff, devices, settingsChanges] =
      await Promise.all([
        this.db.venue.findUniqueOrThrow({ where: { id: venueId } }),
        this.db.station.count({ where: { active: true } }),
        this.db.table.count({ where: { active: true } }),
        this.db.menuItem.count({ where: { archivedAt: null, isAvailable: true } }),
        this.db.staffMember.count({ where: { active: true, role: 'WAITER' } }),
        this.db.staffMember.count({ where: { active: true, role: 'STATION' } }),
        this.db.device.count({ where: { revokedAt: null } }),
        this.db.auditEvent.count({ where: { action: 'SETTINGS_CHANGED' } }),
      ]);
    const items_: ChecklistItemDto[] = [
      {
        key: 'details',
        label: 'Venue details and charges',
        description:
          'Name, logo, payment mode (pay first or pay at the end), VAT and service charge.',
        done: settingsChanges > 0,
        required: false,
        href: '/settings',
      },
      {
        key: 'stations',
        label: 'Stations',
        description: 'Where orders go, e.g. Kitchen and Bar.',
        done: stations > 0,
        required: true,
        href: '/setup/stations',
      },
      {
        key: 'menu',
        label: 'Menu',
        description: 'At least one category and item, each routed to a station.',
        done: items > 0,
        required: true,
        href: '/setup/menu',
      },
      {
        key: 'tables',
        label: 'Tables and QR codes',
        description: 'Add your tables, then download and print the QR code sheet.',
        done: tables > 0,
        required: true,
        href: '/setup/tables',
      },
      {
        key: 'staff',
        label: 'Staff and PINs',
        description: 'Add at least one waiter and one station screen login.',
        done: waiters > 0 && stationStaff > 0,
        required: true,
        href: '/setup/staff',
      },
      {
        key: 'device',
        label: 'Staff devices',
        description: 'Enable PIN login on the tablets and phones your team will use.',
        done: devices > 0,
        required: true,
        href: '/setup/staff',
      },
      {
        key: 'payout',
        label: 'Payout bank account',
        description: 'Needed for customers to pay online (card, transfer, USSD) via Paystack.',
        done: Boolean(venue.paystackSubaccountCode),
        required: venue.paymentMode === 'PREPAY',
        href: '/settings/payouts',
      },
    ];
    return { items: items_, ready: items_.every((i) => !i.required || i.done) };
  }
}
