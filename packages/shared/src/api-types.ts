/** Response DTO types shared by the API and the PWAs. Dates are ISO strings. */
import type {
  AdjustmentType,
  DiscountKind,
  OrderItemStatus,
  OrderStatus,
  PaymentBucket,
  PaymentMethod,
  PaymentMode,
  PaymentStatus,
  ServiceRequestStatus,
  ServiceRequestType,
  StaffRole,
  TableSessionStatus,
  TabStatus,
  VenueStatus,
} from './enums';

export interface OkResponse {
  ok: true;
}

// ---- Auth ---------------------------------------------------------------------------------

export interface MeDto {
  staff: { id: string; name: string; role: StaffRole };
  venue: {
    id: string;
    name: string;
    slug: string;
    status: VenueStatus;
    paymentMode: PaymentMode;
    logoUrl: string | null;
  };
  permissions: string[];
  deviceId: string | null;
}

export interface DeviceInfoDto {
  device: { id: string; name: string };
  venue: { id: string; name: string; logoUrl: string | null; status: VenueStatus };
  staff: { id: string; name: string; role: StaffRole }[];
}

// ---- Venue setup --------------------------------------------------------------------------

export interface VenueSettingsDto {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  logoUrl: string | null;
  status: VenueStatus;
  paymentMode: PaymentMode;
  vatBps: number;
  serviceChargeBps: number;
  pricesIncludeVat: boolean;
  payout: {
    configured: boolean;
    bankName: string | null;
    accountNumberMasked: string | null;
    accountName: string | null;
    subaccountCode: string | null;
  };
  onlinePaymentsEnabled: boolean;
}

export interface ChecklistItemDto {
  key: 'details' | 'stations' | 'tables' | 'menu' | 'staff' | 'device' | 'payout';
  label: string;
  description: string;
  done: boolean;
  required: boolean;
  href: string;
}

export interface ChecklistDto {
  items: ChecklistItemDto[];
  ready: boolean;
}

export interface UploadUrlDto {
  uploadUrl: string;
  headers: Record<string, string>;
  uploadKey: string;
}

export interface StationDto {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface TableDto {
  id: string;
  label: string;
  area: string | null;
  active: boolean;
  qrVersion: number;
  qrUrl: string;
}

export interface AddOnDto {
  id: string;
  name: string;
  priceDeltaKobo: number;
  isAvailable: boolean;
}

export interface AdminMenuItemDto {
  id: string;
  categoryId: string;
  stationId: string;
  name: string;
  description: string | null;
  priceKobo: number;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
  addOns: AddOnDto[];
}

export interface AdminMenuCategoryDto {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  items: AdminMenuItemDto[];
}

export interface StaffDto {
  id: string;
  name: string;
  role: StaffRole;
  email: string | null;
  active: boolean;
  pinLocked: boolean;
}

export interface DeviceDto {
  id: string;
  name: string;
  lastSeenAt: string | null;
  createdAt: string;
  revoked: boolean;
}

export interface BankDto {
  name: string;
  code: string;
}

// ---- Public menu & customer session --------------------------------------------------------

export interface PublicMenuItemDto {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  imageUrl: string | null;
  isAvailable: boolean;
  addOns: AddOnDto[];
}

export interface PublicMenuCategoryDto {
  id: string;
  name: string;
  items: PublicMenuItemDto[];
}

export interface PublicVenueDto {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  paymentMode: PaymentMode;
  onlinePaymentsEnabled: boolean;
  pricesIncludeVat: boolean;
  vatBps: number;
  serviceChargeBps: number;
}

export interface TableLandingDto {
  venue: PublicVenueDto;
  table: { id: string; label: string; area: string | null };
  /** True when a waiter has opened the table: customers may join and order. */
  open: boolean;
  /** True when this device already belongs to the open session. */
  joined: boolean;
  menu: PublicMenuCategoryDto[];
}

export interface TabTotalsDto {
  subtotalKobo: number;
  discountKobo: number;
  serviceChargeKobo: number;
  vatKobo: number;
  vatIncludedKobo: number;
  totalKobo: number;
  paidKobo: number;
  balanceKobo: number;
  overpaidKobo: number;
  pricesIncludeVat: boolean;
  vatBps: number;
  serviceChargeBps: number;
}

export interface OrderItemDto {
  id: string;
  orderId: string;
  menuItemId: string;
  stationId: string;
  name: string;
  addOns: { id: string; name: string; priceDeltaKobo: number }[];
  unitPriceKobo: number;
  quantity: number;
  lineTotalKobo: number;
  note: string | null;
  status: OrderItemStatus;
  billable: boolean;
  version: number;
  createdAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
}

export interface OrderDto {
  id: string;
  number: number;
  status: OrderStatus;
  version: number;
  createdAt: string;
  /** Ordered from this device (customer views only). */
  mine: boolean;
  byStaff: boolean;
  /** PREPAY: amount to pay to release this order to the stations. */
  amountDueKobo: number | null;
  items: OrderItemDto[];
}

export interface PaymentDto {
  id: string;
  reference: string;
  amountKobo: number;
  method: PaymentMethod;
  channel: string | null;
  bucket: PaymentBucket;
  status: PaymentStatus;
  orderId: string | null;
  overpaidKobo: number;
  createdAt: string;
  verifiedAt: string | null;
  mine: boolean;
}

export interface AdjustmentDto {
  id: string;
  type: AdjustmentType;
  discountKind: DiscountKind | null;
  amountKobo: number | null;
  percentBps: number | null;
  appliedKobo: number;
  orderItemId: string | null;
  reason: string;
  requestedBy: { id: string; name: string };
  approvedBy: { id: string; name: string };
  createdAt: string;
}

export interface ServiceRequestDto {
  id: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  createdAt: string;
}

export interface TabDto {
  id: string;
  status: TabStatus;
  version: number;
  receiptToken: string;
  totals: TabTotalsDto;
  orders: OrderDto[];
  payments: PaymentDto[];
  adjustments: AdjustmentDto[];
}

export interface CustomerSessionDto {
  venue: PublicVenueDto;
  table: { id: string; label: string; area: string | null };
  tableSession: {
    id: string;
    status: TableSessionStatus;
    openedAt: string;
    closedAt: string | null;
  };
  tab: TabDto;
  openRequests: ServiceRequestDto[];
  /** Live menu availability for re-checking the cart. */
  menu: PublicMenuCategoryDto[];
}

// ---- Staff operations ----------------------------------------------------------------------

export type FloorTableState = 'CLOSED' | 'OPEN';

export interface FloorTableDto {
  id: string;
  label: string;
  area: string | null;
  state: FloorTableState;
  tableSessionId: string | null;
  tabId: string | null;
  openedAt: string | null;
  itemsReady: number;
  itemsPending: number;
  waiterCalled: boolean;
  billRequested: boolean;
  totalKobo: number;
  balanceKobo: number;
  tabStatus: TabStatus | null;
  awaitingPaymentOrders: number;
  version: number;
  openRequests: (ServiceRequestDto & { tableSessionId: string | null })[];
}

export interface FloorDto {
  tables: FloorTableDto[];
  readyItems: {
    id: string;
    tableLabel: string;
    tableId: string;
    name: string;
    quantity: number;
    readyAt: string;
  }[];
}

export interface StaffTabDto {
  table: { id: string; label: string; area: string | null };
  tableSession: {
    id: string;
    status: TableSessionStatus;
    openedAt: string;
    closedAt: string | null;
    openedBy: string | null;
  };
  tab: TabDto;
  openRequests: ServiceRequestDto[];
  pendingOnlineKobo: number;
}

export interface StationQueueItemDto {
  id: string;
  orderId: string;
  orderNumber: number;
  tableId: string;
  tableLabel: string;
  tableArea: string | null;
  name: string;
  addOns: { name: string }[];
  quantity: number;
  note: string | null;
  status: OrderItemStatus;
  menuItemId: string;
  orderedAt: string;
  version: number;
}

export interface StationQueueDto {
  station: StationDto;
  items: StationQueueItemDto[];
  /** Items marked unavailable in the last few minutes (for one-tap undo). */
  recentlyUnavailable: StationQueueItemDto[];
}

// ---- Payments -----------------------------------------------------------------------------

export interface StartPaymentDto {
  paymentId: string;
  reference: string;
  amountKobo: number;
  authorizationUrl: string;
}

export interface PaymentStatusDto {
  reference: string;
  status: PaymentStatus;
  amountKobo: number;
  tabBalanceKobo: number;
  receiptToken: string;
}

export interface ReceiptDto {
  venue: { name: string; address: string | null; logoUrl: string | null };
  table: { label: string; area: string | null };
  tabStatus: TabStatus;
  openedAt: string;
  closedAt: string | null;
  items: {
    name: string;
    addOns: string[];
    quantity: number;
    unitPriceKobo: number;
    lineTotalKobo: number;
    status: OrderItemStatus;
  }[];
  adjustments: { type: AdjustmentType; reason: string; appliedKobo: number }[];
  totals: TabTotalsDto;
  payments: {
    method: PaymentMethod;
    bucket: PaymentBucket;
    amountKobo: number;
    verifiedAt: string | null;
    reference: string;
  }[];
}

// ---- Owner dashboard / audit / platform ------------------------------------------------------

export interface DashboardDto {
  businessDayStart: string;
  salesTodayKobo: number;
  paymentsToday: number;
  byBucket: Record<PaymentBucket, number>;
  openTabs: {
    tabId: string;
    tableSessionId: string;
    tableLabel: string;
    area: string | null;
    openedAt: string;
    totalKobo: number;
    paidKobo: number;
    balanceKobo: number;
  }[];
  openTabsBalanceKobo: number;
  adjustmentsToday: AdjustmentDto[];
  refundsDue: {
    paymentId: string;
    reference: string;
    tableLabel: string;
    overpaidKobo: number;
    createdAt: string;
  }[];
}

export interface AuditEventDto {
  id: string;
  action: string;
  actorType: string;
  actorName: string | null;
  approverName: string | null;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export interface AuditPageDto {
  events: AuditEventDto[];
  nextCursor: string | null;
}

export interface PlatformVenueDto {
  id: string;
  name: string;
  slug: string;
  status: VenueStatus;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  checklist: ChecklistDto;
  ordersToday: number;
}
