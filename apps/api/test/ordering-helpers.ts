import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { QrTokenService } from '../src/qr/qr-token.service';
import { DEMO, type TestContext } from './helpers';

export async function tableLink(ctx: TestContext, label: string) {
  const table = await ctx.raw.table.findFirstOrThrow({ where: { venueId: ctx.venueId, label } });
  const token = ctx.app
    .get(QrTokenService)
    .sign({ venueId: ctx.venueId, tableId: table.id, version: table.qrVersion });
  return { table, token, base: `/v1/public/t/${DEMO.venueSlug}/${token}` };
}

export function cookieHeader(setCookie: string[] | string | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

export async function listen(ctx: TestContext): Promise<string> {
  const server = ctx.app.getHttpServer() as import('node:http').Server;
  if (!server.listening)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

export async function connectSocket(url: string, cookie?: string): Promise<Socket> {
  const socket = io(url, {
    path: '/socket.io',
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : undefined,
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  // Let the server finish joining rooms in handleConnection.
  await new Promise((r) => setTimeout(r, 100));
  return socket;
}

export function nextEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export async function menuItem(ctx: TestContext, name: string) {
  return ctx.raw.menuItem.findFirstOrThrow({
    where: { venueId: ctx.venueId, name },
    include: { addOns: true },
  });
}
