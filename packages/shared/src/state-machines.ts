import type { OrderItemStatus, TableSessionStatus, TabStatus } from './enums';

export class InvalidTransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Cannot move ${entity} from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Order item lifecycle: SENT → ACCEPTED | UNAVAILABLE; ACCEPTED → READY → SERVED.
 * VOIDED (manager approved) is reachable from any billable state.
 * UNAVAILABLE → SENT exists only for the station's one-tap undo.
 */
export const ORDER_ITEM_TRANSITIONS: Record<OrderItemStatus, readonly OrderItemStatus[]> = {
  SENT: ['ACCEPTED', 'UNAVAILABLE', 'VOIDED'],
  ACCEPTED: ['READY', 'VOIDED'],
  READY: ['SERVED', 'VOIDED'],
  SERVED: ['VOIDED'],
  UNAVAILABLE: ['SENT'],
  VOIDED: [],
};

export function canTransitionOrderItem(from: OrderItemStatus, to: OrderItemStatus): boolean {
  return ORDER_ITEM_TRANSITIONS[from].includes(to);
}

export function assertOrderItemTransition(from: OrderItemStatus, to: OrderItemStatus): void {
  if (!canTransitionOrderItem(from, to)) throw new InvalidTransitionError('order item', from, to);
}

/** Items that count towards the bill. */
export function isBillableItemStatus(status: OrderItemStatus): boolean {
  return status !== 'UNAVAILABLE' && status !== 'VOIDED';
}

/**
 * Table session lifecycle. In the MVP a waiter opens the session directly (OPEN);
 * AWAITING_OPEN is reserved for a future "staff confirms first order" policy.
 */
export const TABLE_SESSION_TRANSITIONS: Record<TableSessionStatus, readonly TableSessionStatus[]> =
  {
    AWAITING_OPEN: ['OPEN', 'CLOSED'],
    OPEN: ['CLOSED'],
    CLOSED: [],
  };

export function canTransitionTableSession(
  from: TableSessionStatus,
  to: TableSessionStatus,
): boolean {
  return TABLE_SESSION_TRANSITIONS[from].includes(to);
}

export function assertTableSessionTransition(
  from: TableSessionStatus,
  to: TableSessionStatus,
): void {
  if (!canTransitionTableSession(from, to))
    throw new InvalidTransitionError('table session', from, to);
}

/** Customers may order only while the session is OPEN. */
export function canOrderInSession(status: TableSessionStatus | null | undefined): boolean {
  return status === 'OPEN';
}

export const TAB_TRANSITIONS: Record<TabStatus, readonly TabStatus[]> = {
  OPEN: ['PAID', 'CLOSED'],
  PAID: ['OPEN', 'CLOSED'],
  CLOSED: [],
};

/** Derives the tab status from its numbers (CLOSED is only set when staff close the table). */
export function deriveTabStatus(
  current: TabStatus,
  totalKobo: number,
  paidKobo: number,
): TabStatus {
  if (current === 'CLOSED') return 'CLOSED';
  return totalKobo > 0 && paidKobo >= totalKobo ? 'PAID' : 'OPEN';
}
