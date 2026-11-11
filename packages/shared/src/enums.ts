/**
 * Domain enums shared by the API and both PWAs. They mirror the Prisma enums in
 * packages/db/prisma/schema.prisma (a unit test in packages/db keeps them in sync).
 */

function values<T extends Record<string, string>>(obj: T): [T[keyof T], ...T[keyof T][]] {
  return Object.values(obj) as [T[keyof T], ...T[keyof T][]];
}

export const StaffRole = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  WAITER: 'WAITER',
  STATION: 'STATION',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];
export const STAFF_ROLES = values(StaffRole);

export const PaymentMode = { PREPAY: 'PREPAY', POSTPAY: 'POSTPAY' } as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];
export const PAYMENT_MODES = values(PaymentMode);

export const VenueStatus = { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED' } as const;
export type VenueStatus = (typeof VenueStatus)[keyof typeof VenueStatus];

export const TableSessionStatus = {
  AWAITING_OPEN: 'AWAITING_OPEN',
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type TableSessionStatus = (typeof TableSessionStatus)[keyof typeof TableSessionStatus];

export const TabStatus = { OPEN: 'OPEN', PAID: 'PAID', CLOSED: 'CLOSED' } as const;
export type TabStatus = (typeof TabStatus)[keyof typeof TabStatus];

export const OrderStatus = {
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PLACED: 'PLACED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const OrderItemStatus = {
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  UNAVAILABLE: 'UNAVAILABLE',
  READY: 'READY',
  SERVED: 'SERVED',
  VOIDED: 'VOIDED',
} as const;
export type OrderItemStatus = (typeof OrderItemStatus)[keyof typeof OrderItemStatus];

export const AdjustmentType = { VOID: 'VOID', DISCOUNT: 'DISCOUNT' } as const;
export type AdjustmentType = (typeof AdjustmentType)[keyof typeof AdjustmentType];

export const DiscountKind = { AMOUNT: 'AMOUNT', PERCENT: 'PERCENT' } as const;
export type DiscountKind = (typeof DiscountKind)[keyof typeof DiscountKind];

export const PaymentMethod = { PAYSTACK: 'PAYSTACK', CASH: 'CASH', POS: 'POS' } as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const ServiceRequestType = {
  CALL_WAITER: 'CALL_WAITER',
  REQUEST_BILL: 'REQUEST_BILL',
} as const;
export type ServiceRequestType = (typeof ServiceRequestType)[keyof typeof ServiceRequestType];
export const SERVICE_REQUEST_TYPES = values(ServiceRequestType);

export const ServiceRequestStatus = { OPEN: 'OPEN', ACKNOWLEDGED: 'ACKNOWLEDGED' } as const;
export type ServiceRequestStatus = (typeof ServiceRequestStatus)[keyof typeof ServiceRequestStatus];

/** How the owner dashboard groups payments ("payments by method"). */
export const PaymentBucket = {
  CARD: 'CARD',
  TRANSFER: 'TRANSFER',
  USSD: 'USSD',
  OTHER_ONLINE: 'OTHER_ONLINE',
  CASH: 'CASH',
  POS: 'POS',
} as const;
export type PaymentBucket = (typeof PaymentBucket)[keyof typeof PaymentBucket];

export function paymentBucket(
  method: PaymentMethod,
  channel: string | null | undefined,
): PaymentBucket {
  if (method === 'CASH') return 'CASH';
  if (method === 'POS') return 'POS';
  switch (channel) {
    case 'card':
      return 'CARD';
    case 'bank_transfer':
      return 'TRANSFER';
    case 'ussd':
      return 'USSD';
    default:
      return 'OTHER_ONLINE';
  }
}

export const AuditAction = {
  VENUE_CREATED: 'VENUE_CREATED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  PAYOUT_CONFIGURED: 'PAYOUT_CONFIGURED',
  STAFF_CREATED: 'STAFF_CREATED',
  STAFF_UPDATED: 'STAFF_UPDATED',
  PIN_LOCKOUT: 'PIN_LOCKOUT',
  DEVICE_ENABLED: 'DEVICE_ENABLED',
  QR_ROTATED: 'QR_ROTATED',
  MENU_AVAILABILITY_CHANGED: 'MENU_AVAILABILITY_CHANGED',
  TABLE_OPENED: 'TABLE_OPENED',
  TABLE_CLOSED: 'TABLE_CLOSED',
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  OVERPAYMENT_FLAGGED: 'OVERPAYMENT_FLAGGED',
  ITEM_VOIDED: 'ITEM_VOIDED',
  DISCOUNT_APPLIED: 'DISCOUNT_APPLIED',
  VENUE_SUSPENDED: 'VENUE_SUSPENDED',
  VENUE_ACTIVATED: 'VENUE_ACTIVATED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const ActorType = {
  STAFF: 'STAFF',
  CUSTOMER: 'CUSTOMER',
  SYSTEM: 'SYSTEM',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];
