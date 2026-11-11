import type { TabDto } from '@app/shared';
import { Notice } from '../../components/ui';

/** Voids and discounts with manager PIN (implemented with owner controls). */
export function AdjustmentDialog(_props: {
  tableSessionId: string;
  target: { orderItemId?: string; type: 'VOID' | 'DISCOUNT' };
  tab: TabDto;
  onDone: () => void | Promise<void>;
}) {
  return <Notice>Not available yet.</Notice>;
}
