import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { parse as parseCookies } from 'cookie';
import type { Server, Socket } from 'socket.io';
import { tenancy, type DbClient } from '@app/db';
import {
  hasPermission,
  Permission,
  Rooms,
  SocketCommand,
  type SubscribeStationPayload,
  type SubscribeTablePayload,
} from '@app/shared';
import { SessionResolver } from '../auth/session-resolver.service';
import { InjectDb } from '../common/db';
import { EventsService } from '../common/events.service';
import type { CustomerPrincipal, StaffPrincipal } from '../common/request';
import { COOKIE } from '../common/tokens.service';
import { PublicMenuService } from '../ordering/public-menu.service';

interface SocketData {
  staff?: StaffPrincipal;
  customer?: CustomerPrincipal;
}

type Ack = { ok: true } | { ok: false; error: string };

/**
 * Socket.IO entry point. Sockets authenticate with the same HttpOnly cookies as HTTP and are
 * placed in rooms they are allowed to see:
 *  - staff: venue:{id} (+ owner:{id} with dashboard access); station:{id} on request
 *  - customers who joined: table-session:{id} and venue-menu:{id}
 *  - anyone holding a valid table QR token: table:{id} and venue-menu:{id} (read-only scanners
 *    learn when the waiter opens the table)
 * Events are notifications only; clients refetch over REST.
 */
@WebSocketGateway({ path: '/socket.io' })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger('Realtime');

  constructor(
    private readonly events: EventsService,
    private readonly sessions: SessionResolver,
    private readonly menu: PublicMenuService,
    @InjectDb() private readonly db: DbClient,
  ) {}

  afterInit(server: Server): void {
    this.events.attach(server);
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie ?? '');
      const data = socket.data as SocketData;
      const [staff, customer] = await Promise.all([
        this.sessions.staff(cookies[COOKIE.staff]),
        this.sessions.customer(cookies[COOKIE.customer]),
      ]);
      const rooms: string[] = [];
      if (staff) {
        data.staff = staff;
        rooms.push(Rooms.venue(staff.venueId));
        if (hasPermission(staff.role, Permission.DASHBOARD_VIEW))
          rooms.push(Rooms.owner(staff.venueId));
      }
      if (customer) {
        data.customer = customer;
        rooms.push(Rooms.tableSession(customer.tableSessionId), Rooms.venueMenu(customer.venueId));
      }
      if (rooms.length) await socket.join(rooms);
    } catch (err) {
      this.logger.warn(`Socket auth failed: ${String(err)}`);
    }
  }

  @SubscribeMessage(SocketCommand.SUBSCRIBE_TABLE)
  async subscribeTable(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: SubscribeTablePayload,
  ): Promise<Ack> {
    try {
      if (typeof body?.venueSlug !== 'string' || typeof body?.tableToken !== 'string')
        return { ok: false, error: 'invalid' };
      const resolved = await tenancy.run(() =>
        this.menu.resolveTable(body.venueSlug, body.tableToken, { bind: false }),
      );
      await socket.join([Rooms.table(resolved.table.id), Rooms.venueMenu(resolved.venue.id)]);
      return { ok: true };
    } catch {
      return { ok: false, error: 'invalid table' };
    }
  }

  @SubscribeMessage(SocketCommand.SUBSCRIBE_STATION)
  async subscribeStation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: SubscribeStationPayload,
  ): Promise<Ack> {
    const staff = (socket.data as SocketData).staff;
    if (!staff || !hasPermission(staff.role, Permission.STATION_OPERATE))
      return { ok: false, error: 'forbidden' };
    if (typeof body?.stationId !== 'string') return { ok: false, error: 'invalid' };
    const station = await tenancy
      .runForVenue(staff.venueId, () =>
        this.db.station.findUnique({ where: { id: body.stationId } }),
      )
      .catch(() => null);
    if (!station) return { ok: false, error: 'not found' };
    await socket.join(Rooms.station(station.id));
    return { ok: true };
  }
}
