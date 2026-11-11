import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { SocketEvent, SocketPayload } from '@app/shared';

export interface PendingEvent {
  rooms: string[];
  event: SocketEvent;
  payload: SocketPayload;
}

/**
 * Publishes realtime notifications. Call only after the database transaction has committed:
 * events are hints to refetch, REST stays the source of truth.
 */
@Injectable()
export class EventsService {
  private server: Server | null = null;
  private readonly logger = new Logger('Events');

  attach(server: Server): void {
    this.server = server;
  }

  emit(rooms: string[], event: SocketEvent, payload: SocketPayload): void {
    if (!this.server || rooms.length === 0) return;
    try {
      this.server.to(rooms).emit(event, payload);
    } catch (err) {
      this.logger.warn(`Failed to emit ${event}: ${String(err)}`);
    }
  }

  emitAll(events: PendingEvent[]): void {
    for (const e of events) this.emit(e.rooms, e.event, e.payload);
  }
}
