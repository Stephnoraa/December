import { useEffect, useRef, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { SocketEvent, SocketPayload } from '@app/shared';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || undefined;
let shared: Socket | null = null;

export function getSocket(): Socket {
  if (!shared) {
    shared = io(BASE ?? window.location.origin, {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10_000,
    });
  }
  return shared;
}

let generation = 0;
const subscribers = new Set<() => void>();

/** Reconnects so the socket picks up a new customer cookie (after joining a table). */
export function resetSocket(): void {
  shared?.disconnect();
  shared = null;
  generation += 1;
  subscribers.forEach((fn) => fn());
}

function useSocketGeneration(): number {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => generation,
  );
}

/**
 * Subscribes to events; `onReconnect` runs after every (re)connection so the page can refetch
 * and re-join rooms (events are hints, REST is the source of truth).
 */
export function useSocket(
  events: SocketEvent[],
  handler: (event: SocketEvent, payload: SocketPayload) => void,
  onConnect?: (socket: Socket) => void,
  key = '',
): void {
  const handlerRef = useRef(handler);
  const connectRef = useRef(onConnect);
  handlerRef.current = handler;
  connectRef.current = onConnect;
  const eventsKey = events.join('|');
  // Re-attach listeners whenever the socket is replaced.
  const gen = useSocketGeneration();
  useEffect(() => {
    const s = getSocket();
    const listeners = eventsKey.split('|').map((event) => {
      const fn = (payload: SocketPayload) => handlerRef.current(event as SocketEvent, payload);
      s.on(event, fn);
      return [event, fn] as const;
    });
    const connect = () => connectRef.current?.(s);
    s.on('connect', connect);
    if (s.connected) connect();
    return () => {
      listeners.forEach(([event, fn]) => s.off(event, fn));
      s.off('connect', connect);
    };
  }, [eventsKey, key, gen]);
}
