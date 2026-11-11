import type { VenueSettingsDto } from '@app/shared';
import { Card, Notice } from '../components/ui';

/** Paystack payout onboarding (filled in with M4). */
export function Payouts({ venue }: { venue: VenueSettingsDto }) {
  return (
    <Card>
      <h2 className="font-bold">Payout bank account</h2>
      {venue.payout.configured ? (
        <Notice tone="green">
          Payouts go to {venue.payout.accountName} · {venue.payout.bankName}{' '}
          {venue.payout.accountNumberMasked}
        </Notice>
      ) : (
        <Notice tone="amber">Not set up yet.</Notice>
      )}
    </Card>
  );
}
