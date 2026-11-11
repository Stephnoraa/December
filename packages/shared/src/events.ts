/**
 * Socket.IO event names and payloads. Events are notifications only: clients refetch the
 * affected resource over REST and ignore events whose `version` is older than what they have.
 */
export const SocketEvent = {
  TABLE_SESSION_OPENED: 'tableSession.opened',
  TABLE_SESSION_CLOSED: 'tableSession.closed',
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_ITEM_UPDATED: 'orderItem.updated',
  STATION_QUEUE_CHANGED: 'station.queueChanged',
  TAB_UPDATED: 'tab.updated',
  PAYMENT_UPDATED: 'payment.updated',
  MENU_CHANGED: 'menu.changed',
  SERVICE_REQUEST_CHANGED: 'serviceRequest.changed',
  FLOOR_CHANGED: 'floor.changed',
  VENUE_STATUS_CHANGED: 'venue.statusChanged',
} as const;
export type SocketEvent = (typeof SocketEvent)[keyof typeof SocketEvent];

/** Messages a client sends to subscribe to rooms it is allowed to see. */
export const SocketCommand = {
  SUBSCRIBE_TABLE: 'subscribe.table',
  SUBSCRIBE_STATION: 'subscribe.station',
} as const;

export const Rooms = {
  venue: (venueId: string) => `venue:${venueId}`,
  owner: (venueId: string) => `owner:${venueId}`,
  station: (stationId: string) => `station:${stationId}`,
  tableSession: (tableSessionId: string) => `table-session:${tableSessionId}`,
  /** Public room for a physical table: lets read-only scanners see the table open. */
  table: (tableId: string) => `table:${tableId}`,
  /** Public menu room: availability changes for every customer at the venue. */
  venueMenu: (venueId: string) => `venue-menu:${venueId}`,
} as const;

export interface SocketPayload {
  venueId: string;
  tableSessionId?: string;
  tableId?: string;
  tabId?: string;
  orderId?: string;
  orderItemId?: string;
  stationId?: string;
  paymentId?: string;
  menuItemId?: string;
  /** Monotonic version of the tab or order the event refers to. */
  version?: number;
}

export interface SubscribeTablePayload {
  venueSlug: string;
  tableToken: string;
}

export interface SubscribeStationPayload {
  stationId: string;
}
