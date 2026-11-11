import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { SocketCommand, type SocketEvent, type SocketPayload } from '@app/shared';

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

/** Drops the connection so the next one re-authenticates (after login/logout). */
export function resetSocket(): void {
  shared?.disconnect();
  shared = null;
}

export type ConnectionState = 'connecting' | 'online' | 'offline';

/**
 * Keeps the socket connected and, on every (re)connect, refetches all active queries:
 * socket events are only hints, REST is the source of truth.
 */
export function useLiveConnection(): ConnectionState {
  const qc = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const s = getSocket();
    const onConnect = () => {
      setState('online');
      void qc.invalidateQueries();
    };
    const onDisconnect = () => setState('offline');
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onDisconnect);
    if (s.connected) setState('online');
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onDisconnect);
    };
  }, [qc]);
  return state;
}

/** Runs handler for the given events while mounted. */
export function useSocketEvents(
  events: SocketEvent[],
  handler: (event: SocketEvent, payload: SocketPayload) => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;
  const key = events.join('|');
  useEffect(() => {
    const s = getSocket();
    const subs = key.split('|').map((event) => {
      const fn = (payload: SocketPayload) => ref.current(event as SocketEvent, payload);
      s.on(event, fn);
      return [event, fn] as const;
    });
    return () => subs.forEach(([event, fn]) => s.off(event, fn));
  }, [key]);
}

/** Joins a station room (re-sent after every reconnect). */
export function useStationRoom(stationId: string | null): void {
  useEffect(() => {
    if (!stationId) return;
    const s = getSocket();
    const join = () => s.emit(SocketCommand.SUBSCRIBE_STATION, { stationId });
    join();
    s.on('connect', join);
    return () => {
      s.off('connect', join);
    };
  }, [stationId]);
}
