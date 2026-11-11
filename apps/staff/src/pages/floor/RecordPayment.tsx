import type { StaffTabDto } from '@app/shared';
import { Notice } from '../../components/ui';

/** Cash / POS recording (implemented with payments). */
export function RecordPayment({ data }: { data: StaffTabDto; onDone: () => void | Promise<void> }) {
  return <Notice>Balance due: {data.tab.totals.balanceKobo}</Notice>;
}
