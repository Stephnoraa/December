import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  elapsedLabel,
  SocketEvent,
  type StationDto,
  type StationQueueDto,
  type StationQueueItemDto,
} from '@app/shared';
import { errorMessage, get, post } from '../../lib/api';
import { useSocketEvents, useStationRoom } from '../../lib/socket';
import { chime, unlockAudio } from '../../lib/sound';
import { useNow } from '../../lib/useNow';
import { Button, cx, ErrorBanner, Loading } from '../../components/ui';

const STORAGE_KEY = 'station-id';

function readStation(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export default function Station() {
  const stations = useQuery({
    queryKey: ['staff-stations'],
    queryFn: () => get<StationDto[]>('/v1/staff/stations'),
  });
  const [stationId, setStationId] = useState<string | null>(readStation);
  const [started, setStarted] = useState(false);
  const choose = (id: string | null) => {
    setStationId(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };
  if (stations.isLoading) return <Loading />;
  const list = stations.data ?? [];
  const current = list.find((s) => s.id === stationId);
  if (!current || !started) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-3xl bg-slate-900 p-6 text-white">
        <h1 className="text-2xl font-bold">Station screen</h1>
        <p className="text-slate-300">
          Choose this screen's station. Tapping start also turns on the sound alert for new orders.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                choose(s.id);
                unlockAudio();
                setStarted(true);
              }}
              className={cx(
                'rounded-2xl px-5 py-6 text-left text-xl font-bold ring-2',
                s.id === stationId
                  ? 'bg-emerald-500 text-slate-950 ring-emerald-300'
                  : 'bg-slate-800 ring-slate-700',
              )}
            >
              Start {s.name}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return <StationQueue station={current} onSwitch={() => setStarted(false)} />;
}

function StationQueue({ station, onSwitch }: { station: StationDto; onSwitch: () => void }) {
  const qc = useQueryClient();
  const key = ['station-queue', station.id];
  const queue = useQuery({
    queryKey: key,
    queryFn: () => get<StationQueueDto>(`/v1/staff/stations/${station.id}/queue`),
    refetchInterval: 30_000,
  });
  useStationRoom(station.id);
  useSocketEvents(
    [SocketEvent.STATION_QUEUE_CHANGED, SocketEvent.ORDER_ITEM_UPDATED],
    () => void qc.invalidateQueries({ queryKey: key }),
  );
  const now = useNow(15_000);

  // Chime when new items appear.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set((queue.data?.items ?? []).map((i) => i.id));
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) chime();
    if (queue.data) seen.current = ids;
  }, [queue.data]);

  const action = useMutation({
    mutationFn: ({ id, act, body }: { id: string; act: string; body?: unknown }) =>
      post(`/v1/staff/order-items/${id}/${act}`, body ?? {}),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const groups = useMemo(() => {
    const map = new Map<string, StationQueueItemDto[]>();
    for (const i of queue.data?.items ?? []) {
      const k = `${i.tableId}`;
      map.set(k, [...(map.get(k) ?? []), i]);
    }
    return [...map.values()];
  }, [queue.data]);

  return (
    <div className="-mx-4 -my-5 min-h-[calc(100vh-7rem)] bg-slate-950 px-4 py-5 text-white">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-black tracking-tight">{station.name}</h1>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-lg font-bold tabular-nums">
            {queue.data?.items.length ?? 0}{' '}
            {(queue.data?.items.length ?? 0) === 1 ? 'item' : 'items'}
          </span>
          <Button variant="secondary" size="sm" onClick={onSwitch}>
            Switch station
          </Button>
        </div>
      </div>
      <ErrorBanner error={action.error ? errorMessage(action.error) : null} />
      {queue.isLoading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <p className="mt-16 text-center text-2xl font-semibold text-slate-400">
          No orders right now.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((items) => (
            <section
              key={items[0]!.tableId}
              className="rounded-3xl bg-slate-900 p-4 ring-1 ring-slate-700"
              aria-label={`Table ${items[0]!.tableLabel}`}
            >
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-3xl font-black">Table {items[0]!.tableLabel}</h2>
                <span className="text-sm text-slate-400">{items[0]!.tableArea}</span>
              </div>
              <ul className="space-y-3">
                {items.map((i) => {
                  const mins = (now.getTime() - new Date(i.orderedAt).getTime()) / 60_000;
                  return (
                    <li
                      key={i.id}
                      className={cx(
                        'rounded-2xl p-3',
                        i.status === 'ACCEPTED'
                          ? 'bg-indigo-950 ring-2 ring-indigo-500'
                          : 'bg-slate-800',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-2xl font-bold leading-tight">
                          <span className="text-emerald-400">{i.quantity}×</span> {i.name}
                        </p>
                        <span
                          className={cx(
                            'shrink-0 rounded-lg px-2 py-1 text-sm font-bold tabular-nums',
                            mins >= 20
                              ? 'bg-red-600'
                              : mins >= 10
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-700',
                          )}
                        >
                          {elapsedLabel(i.orderedAt, now)}
                        </span>
                      </div>
                      {i.addOns.length > 0 && (
                        <p className="mt-1 text-lg text-amber-300">
                          + {i.addOns.map((a) => a.name).join(', ')}
                        </p>
                      )}
                      {i.note && (
                        <p className="mt-1 rounded-lg bg-amber-400 px-2 py-1 text-lg font-semibold text-slate-950">
                          “{i.note}”
                        </p>
                      )}
                      <p className="mt-1 text-xs text-slate-400">Order #{i.orderNumber}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {i.status === 'SENT' ? (
                          <>
                            <Button
                              size="lg"
                              variant="success"
                              className="py-4 text-lg"
                              onClick={() => action.mutate({ id: i.id, act: 'accept' })}
                            >
                              Accept
                            </Button>
                            <Button
                              size="lg"
                              variant="danger"
                              className="py-4 text-lg"
                              onClick={() =>
                                action.mutate({
                                  id: i.id,
                                  act: 'unavailable',
                                  body: { disableMenuItem: true },
                                })
                              }
                            >
                              Unavailable
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="lg"
                            variant="warning"
                            className="col-span-2 py-4 text-lg"
                            onClick={() => action.mutate({ id: i.id, act: 'ready' })}
                          >
                            Ready
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {(queue.data?.recentlyUnavailable.length ?? 0) > 0 && (
        <div className="mt-6 rounded-3xl bg-slate-900 p-4 ring-1 ring-red-900">
          <h2 className="mb-2 font-bold text-red-300">
            Marked unavailable (also switched off on the menu)
          </h2>
          <ul className="space-y-2">
            {queue.data!.recentlyUnavailable.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <span>
                  {i.quantity}× {i.name} · Table {i.tableLabel}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => action.mutate({ id: i.id, act: 'undo-unavailable' })}
                >
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
