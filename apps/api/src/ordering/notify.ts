import { Rooms, SocketEvent, type SocketPayload } from '@app/shared';
import type { PendingEvent } from '../common/events.service';

/** Builders for the realtime notifications sent after a change commits. */
export const notify = {
  tab(venueId: string, tableSessionId: string, tabId: string, version: number): PendingEvent[] {
    const payload: SocketPayload = { venueId, tableSessionId, tabId, version };
    return [
      {
        rooms: [Rooms.tableSession(tableSessionId), Rooms.venue(venueId), Rooms.owner(venueId)],
        event: SocketEvent.TAB_UPDATED,
        payload,
      },
      { rooms: [Rooms.venue(venueId)], event: SocketEvent.FLOOR_CHANGED, payload },
    ];
  },
  stations(
    venueId: string,
    stationIds: Iterable<string>,
    extra: SocketPayload = { venueId },
  ): PendingEvent[] {
    return [...new Set(stationIds)].map((stationId) => ({
      rooms: [Rooms.station(stationId)],
      event: SocketEvent.STATION_QUEUE_CHANGED,
      payload: { ...extra, venueId, stationId },
    }));
  },
  item(
    venueId: string,
    tableSessionId: string,
    orderItemId: string,
    version: number,
  ): PendingEvent {
    return {
      rooms: [Rooms.tableSession(tableSessionId), Rooms.venue(venueId)],
      event: SocketEvent.ORDER_ITEM_UPDATED,
      payload: { venueId, tableSessionId, orderItemId, version },
    };
  },
  order(
    venueId: string,
    tableSessionId: string,
    orderId: string,
    version: number,
    created = false,
  ): PendingEvent {
    return {
      rooms: [Rooms.tableSession(tableSessionId), Rooms.venue(venueId)],
      event: created ? SocketEvent.ORDER_CREATED : SocketEvent.ORDER_UPDATED,
      payload: { venueId, tableSessionId, orderId, version },
    };
  },
  serviceRequest(venueId: string, tableSessionId: string | null, tableId: string): PendingEvent[] {
    const rooms = [Rooms.venue(venueId)];
    if (tableSessionId) rooms.push(Rooms.tableSession(tableSessionId));
    return [
      {
        rooms,
        event: SocketEvent.SERVICE_REQUEST_CHANGED,
        payload: { venueId, tableSessionId: tableSessionId ?? undefined, tableId },
      },
      {
        rooms: [Rooms.venue(venueId)],
        event: SocketEvent.FLOOR_CHANGED,
        payload: { venueId, tableId },
      },
    ];
  },
  tableSession(
    venueId: string,
    tableId: string,
    tableSessionId: string,
    opened: boolean,
  ): PendingEvent[] {
    const payload = { venueId, tableId, tableSessionId };
    const event = opened ? SocketEvent.TABLE_SESSION_OPENED : SocketEvent.TABLE_SESSION_CLOSED;
    return [
      {
        rooms: [
          Rooms.table(tableId),
          Rooms.tableSession(tableSessionId),
          Rooms.venue(venueId),
          Rooms.owner(venueId),
        ],
        event,
        payload,
      },
      { rooms: [Rooms.venue(venueId)], event: SocketEvent.FLOOR_CHANGED, payload },
    ];
  },
};
