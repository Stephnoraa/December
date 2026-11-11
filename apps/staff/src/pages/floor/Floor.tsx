import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { elapsedLabel, SocketEvent, type FloorDto, type FloorTableDto } from '@app/shared';
import { errorMessage, get, post } from '../../lib/api';
import { useSocketEvents } from '../../lib/socket';
import { useNow } from '../../lib/useNow';
import {
  Badge,
  Button,
  Card,
  cx,
  ErrorBanner,
  Loading,
  Modal,
  Money,
  PageHeader,
} from '../../components/ui';

export function useFloor() {
  const qc = useQueryClient();
  const floor = useQuery({
    queryKey: ['floor'],
    queryFn: () => get<FloorDto>('/v1/staff/floor'),
    refetchInterval: 60_000,
  });
  useSocketEvents(
    [
      SocketEvent.FLOOR_CHANGED,
      SocketEvent.TAB_UPDATED,
      SocketEvent.ORDER_ITEM_UPDATED,
      SocketEvent.SERVICE_REQUEST_CHANGED,
      SocketEvent.ORDER_CREATED,
      SocketEvent.PAYMENT_UPDATED,
    ],
    () => void qc.invalidateQueries({ queryKey: ['floor'] }),
  );
  return floor;
}

function tableTone(t: FloorTableDto): string {
  if (t.waiterCalled || t.billRequested) return 'bg-amber-50 ring-amber-400';
  if (t.itemsReady > 0) return 'bg-emerald-50 ring-emerald-500';
  if (t.state === 'OPEN') return 'bg-white ring-sky-400';
  return 'bg-slate-100 ring-slate-200';
}

export default function Floor() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const floor = useFloor();
  const now = useNow();
  const [confirmOpen, setConfirmOpen] = useState<FloorTableDto | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['floor'] });
  const open = useMutation({
    mutationFn: (t: FloorTableDto) =>
      post<{ tableSessionId: string }>(`/v1/staff/tables/${t.id}/open`),
    onSuccess: async (res) => {
      setConfirmOpen(null);
      await refresh();
      navigate(`/floor/sessions/${res.tableSessionId}`);
    },
  });
  const serve = useMutation({
    mutationFn: (id: string) => post(`/v1/staff/order-items/${id}/serve`),
    onSettled: refresh,
  });
  const ack = useMutation({
    mutationFn: (id: string) => post(`/v1/staff/service-requests/${id}/ack`),
    onSettled: refresh,
  });

  const areas = useMemo(() => {
    const map = new Map<string, FloorTableDto[]>();
    for (const t of floor.data?.tables ?? [])
      map.set(t.area ?? 'Tables', [...(map.get(t.area ?? 'Tables') ?? []), t]);
    return [...map.entries()];
  }, [floor.data]);
  const requests = (floor.data?.tables ?? []).flatMap((t) =>
    t.openRequests.map((r) => ({ ...r, table: t })),
  );

  if (floor.isLoading) return <Loading />;
  const error = open.error ?? serve.error ?? ack.error;
  return (
    <div className="space-y-5">
      <PageHeader title="Floor" subtitle="Tap a closed table to open it for ordering." />
      <ErrorBanner error={error ? errorMessage(error) : null} />

      {requests.length > 0 && (
        <Card className="ring-amber-300">
          <h2 className="mb-2 font-bold">Customers asking</h2>
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <span>
                  <strong>Table {r.table.label}</strong>{' '}
                  {r.type === 'CALL_WAITER' ? 'called a waiter' : 'wants the bill'} ·{' '}
                  {elapsedLabel(r.createdAt, now)} ago
                </span>
                <Button size="sm" variant="warning" onClick={() => ack.mutate(r.id)}>
                  On my way
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(floor.data?.readyItems.length ?? 0) > 0 && (
        <Card className="ring-emerald-300">
          <h2 className="mb-2 font-bold">Ready to serve</h2>
          <ul className="space-y-2">
            {floor.data!.readyItems.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <span>
                  <strong>Table {i.tableLabel}</strong> · {i.quantity}× {i.name}
                </span>
                <Button size="sm" variant="success" onClick={() => serve.mutate(i.id)}>
                  Served
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {areas.map(([area, tables]) => (
        <section key={area}>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{area}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {tables.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  t.tableSessionId
                    ? navigate(`/floor/sessions/${t.tableSessionId}`)
                    : setConfirmOpen(t)
                }
                className={cx(
                  'flex min-h-28 flex-col justify-between rounded-2xl p-3 text-left ring-2',
                  tableTone(t),
                )}
                aria-label={`Table ${t.label}, ${t.state === 'OPEN' ? 'open' : 'closed'}`}
              >
                <div className="flex items-start justify-between">
                  <span className="text-2xl font-black">{t.label}</span>
                  {t.state === 'OPEN' ? <Badge tone="blue">open</Badge> : <Badge>closed</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.waiterCalled && <Badge tone="amber">waiter called</Badge>}
                  {t.billRequested && <Badge tone="amber">bill requested</Badge>}
                  {t.itemsReady > 0 && <Badge tone="green">{t.itemsReady} ready</Badge>}
                  {t.itemsPending > 0 && <Badge tone="slate">{t.itemsPending} cooking</Badge>}
                  {t.awaitingPaymentOrders > 0 && <Badge tone="purple">awaiting payment</Badge>}
                  {t.state === 'OPEN' && t.tabStatus === 'PAID' && <Badge tone="green">paid</Badge>}
                </div>
                {t.state === 'OPEN' && (
                  <p className="mt-2 text-sm">
                    {t.balanceKobo > 0 ? (
                      <>
                        Due <Money kobo={t.balanceKobo} className="font-bold" />
                      </>
                    ) : (
                      <span className="text-slate-500">
                        {t.openedAt && `Open ${elapsedLabel(t.openedAt, now)}`}
                      </span>
                    )}
                  </p>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}

      <Modal
        open={confirmOpen !== null}
        onClose={() => setConfirmOpen(null)}
        title={`Open table ${confirmOpen?.label ?? ''}?`}
      >
        <p className="text-slate-600">
          Customers at this table can order from their phones once it is open.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmOpen(null)}>
            Cancel
          </Button>
          <Button
            variant="success"
            className="flex-1"
            busy={open.isPending}
            onClick={() => confirmOpen && open.mutate(confirmOpen)}
          >
            Open table
          </Button>
        </div>
      </Modal>
    </div>
  );
}
