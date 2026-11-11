import type { CustomerSessionDto } from '@app/shared';
import { Button } from '../../components/ui';

/** Online payment entry point (implemented with payments). */
export function PayButton({ session }: { session: CustomerSessionDto }) {
  return (
    <Button variant="dark" className="px-2 text-sm" disabled={session.tab.totals.balanceKobo === 0}>
      💳 Pay
    </Button>
  );
}
