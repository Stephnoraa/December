import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  formatVenueTime,
  Permission,
  SocketEvent,
  type OrderItemStatus,
  type StaffTabDto,
} from '@app/shared';
import { errorMessage, get, post } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useSocketEvents } from '../../lib/socket';
import {
  Badge,
  Button,
  Card,
  cx,
  ErrorBanner,
  Loading,
  Modal,
  Money,
  Notice,
  PageHeader,
} from '../../components/ui';
import { RecordPayment } from './RecordPayment';
import { AdjustmentDialog } from './AdjustmentDialog';

const STATUS_TONE: Record<
  OrderItemStatus,
  'slate' | 'blue' | 'red' | 'amber' | 'green' | 'purple'
> = {
  SENT: 'blue',
  ACCEPTED: 'purple',
  UNAVAILABLE: 'red',
  READY: 'amber',
  SERVED: 'green',
  VOIDED: 'slate',
};

export default function TableTab() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = useSession();
  const key = ['staff-tab', id];
  const data = useQuery({
    queryKey: key,
    queryFn: () => get<StaffTabDto>(`/v1/staff/sessions/${id}`),
  });
  useSocketEvents(
    [
      SocketEvent.TAB_UPDATED,
      SocketEvent.ORDER_ITEM_UPDATED,
      SocketEvent.ORDER_CREATED,
      SocketEvent.PAYMENT_UPDATED,
      SocketEvent.SERVICE_REQUEST_CHANGED,
    ],
    (event, payload) => {
      if (payload.tableSessionId && payload.tableSessionId !== id) return;
      const current = qc.getQueryData<StaffTabDto>(key);
      if (
        event === SocketEvent.TAB_UPDATED &&
        current &&
        payload.version !== undefined &&
        payload.version <= current.tab.version
      )
        return;
      void qc.invalidateQueries({ queryKey: key });
    },
  );
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ queryKey: ['floor'] }),
    ]);
  const serve = useMutation({
    mutationFn: (itemId: string) => post(`/v1/staff/order-items/${itemId}/serve`),
    onSettled: refresh,
  });
  const ack = useMutation({
    mutationFn: (reqId: string) => post(`/v1/staff/service-requests/${reqId}/ack`),
    onSettled: refresh,
  });
  const close = useMutation({
    mutationFn: () => post(`/v1/staff/sessions/${id}/close`),
    onSuccess: async () => {
      await refresh();
      navigate('/floor');
    },
  });
  const [paying, setPaying] = useState(false);
  const [adjusting, setAdjusting] = useState<{
    orderItemId?: string;
    type: 'VOID' | 'DISCOUNT';
  } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  if (data.isLoading) return <Loading />;
  if (!data.data)
    return <ErrorBanner error={data.error ? errorMessage(data.error) : 'Not found'} />;
  const { table, tableSession, tab, openRequests, pendingOnlineKobo } = data.data;
  const t = tab.totals;
  const isOpen = tableSession.status === 'OPEN';
  const error = serve.error ?? ack.error ?? close.error;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Table ${table.label}`}
        subtitle={`${table.area ? `${table.area} · ` : ''}Opened ${formatVenueTime(tableSession.openedAt)}${tableSession.openedBy ? ` by ${tableSession.openedBy}` : ''}${isOpen ? '' : ' · closed'}`}
        actions={
          <Link
            to="/floor"
            className="rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-slate-300"
          >
            ← Floor
          </Link>
        }
      />
      <ErrorBanner error={error ? errorMessage(error) : null} />
      {openRequests.map((r) => (
        <Notice key={r.id} tone="amber">
          <span className="flex items-center justify-between gap-3">
            {r.type === 'CALL_WAITER' ? 'Customer called a waiter' : 'Customer asked for the bill'}{' '}
            ({formatVenueTime(r.createdAt)})
            <Button size="sm" variant="warning" onClick={() => ack.mutate(r.id)}>
              On my way
            </Button>
          </span>
        </Notice>
      ))}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {tab.orders.length === 0 && <Card>No orders yet.</Card>}
          {tab.orders.map((o) => (
            <Card key={o.id} className="p-0">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-sm">
                <span className="font-bold">Order #{o.number}</span>
                <span className="flex items-center gap-2 text-slate-500">
                  {o.status === 'AWAITING_PAYMENT' && (
                    <Badge tone="purple">
                      awaiting payment · <Money kobo={o.amountDueKobo ?? 0} />
                    </Badge>
                  )}
                  {formatVenueTime(o.createdAt)}
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {o.items.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                  >
                    <div
                      className={cx(
                        !i.billable && o.status === 'PLACED' && 'text-slate-400 line-through',
                      )}
                    >
                      <p className="font-semibold">
                        {i.quantity}× {i.name}
                      </p>
                      {i.addOns.length > 0 && (
                        <p className="text-sm text-slate-500">
                          {i.addOns.map((a) => a.name).join(', ')}
                        </p>
                      )}
                      {i.note && <p className="text-sm italic text-slate-500">“{i.note}”</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Money kobo={i.lineTotalKobo} className="text-sm" />
                      <Badge tone={STATUS_TONE[i.status]}>{i.status.toLowerCase()}</Badge>
                      {i.status === 'READY' && (
                        <Button size="sm" variant="success" onClick={() => serve.mutate(i.id)}>
                          Served
                        </Button>
                      )}
                      {isOpen && i.billable && can(Permission.ADJUSTMENTS_REQUEST) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setAdjusting({ type: 'VOID', orderItemId: i.id })}
                        >
                          Void
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          {tab.adjustments.length > 0 && (
            <Card>
              <h2 className="mb-2 font-bold">Voids and discounts</h2>
              <ul className="space-y-1 text-sm">
                {tab.adjustments.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <span>
                      {a.type === 'VOID'
                        ? 'Void'
                        : a.discountKind === 'PERCENT'
                          ? `${(a.percentBps ?? 0) / 100}% discount`
                          : 'Discount'}{' '}
                      · {a.reason} · approved by {a.approvedBy.name}
                    </span>
                    <span className="tabular-nums">
                      −<Money kobo={a.appliedKobo} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-3">
          <Card>
            <dl className="space-y-1 text-sm">
              <Row label="Subtotal" kobo={t.subtotalKobo} />
              {t.discountKobo > 0 && <Row label="Discounts" kobo={-t.discountKobo} />}
              {t.serviceChargeKobo > 0 && (
                <Row
                  label={`Service charge ${t.serviceChargeBps / 100}%`}
                  kobo={t.serviceChargeKobo}
                />
              )}
              <Row
                label={`VAT ${t.vatBps / 100}%${t.pricesIncludeVat ? ' (incl.)' : ''}`}
                kobo={t.vatKobo}
                muted={t.pricesIncludeVat}
              />
              <div className="border-t border-slate-100 pt-1" />
              <Row label="Total" kobo={t.totalKobo} strong />
              <Row label="Paid" kobo={t.paidKobo} />
              <Row label="Balance" kobo={t.balanceKobo} strong />
              {t.overpaidKobo > 0 && <Row label="Overpaid (refund due)" kobo={t.overpaidKobo} />}
            </dl>
            {pendingOnlineKobo > 0 && (
              <p className="mt-2 text-sm text-slate-600">
                <Money kobo={pendingOnlineKobo} /> is being paid online right now.
              </p>
            )}
          </Card>
          {tab.payments.length > 0 && (
            <Card>
              <h2 className="mb-2 font-bold">Payments</h2>
              <ul className="space-y-1 text-sm">
                {tab.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>
                      {p.bucket.toLowerCase().replace('_', ' ')}{' '}
                      {p.status === 'PENDING' && <Badge tone="amber">pending</Badge>}
                    </span>
                    <Money kobo={p.amountKobo} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {isOpen && (
            <div className="grid gap-2">
              {can(Permission.PAYMENTS_RECORD) && t.balanceKobo > 0 && (
                <Button size="lg" variant="success" onClick={() => setPaying(true)}>
                  Record cash / POS payment
                </Button>
              )}
              {can(Permission.ADJUSTMENTS_REQUEST) && t.totalKobo > 0 && (
                <Button variant="secondary" onClick={() => setAdjusting({ type: 'DISCOUNT' })}>
                  Discount…
                </Button>
              )}
              <Button
                variant={t.balanceKobo === 0 ? 'primary' : 'secondary'}
                disabled={t.balanceKobo > 0}
                onClick={() => setConfirmClose(true)}
              >
                Close table
              </Button>
              {t.balanceKobo > 0 && (
                <p className="text-center text-xs text-slate-500">
                  The table can be closed once the balance is paid.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <Modal
        open={paying}
        onClose={() => setPaying(false)}
        title={`Record payment · Table ${table.label}`}
      >
        {paying && (
          <RecordPayment
            data={data.data}
            onDone={async () => {
              setPaying(false);
              await refresh();
            }}
          />
        )}
      </Modal>
      <Modal
        open={adjusting !== null}
        onClose={() => setAdjusting(null)}
        title={adjusting?.type === 'VOID' ? 'Void item' : 'Discount'}
      >
        {adjusting && (
          <AdjustmentDialog
            tableSessionId={id}
            target={adjusting}
            tab={tab}
            onDone={async () => {
              setAdjusting(null);
              await refresh();
            }}
          />
        )}
      </Modal>
      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title={`Close table ${table.label}?`}
      >
        <p className="text-slate-600">
          The tab is settled. Closing ends this session; the next guests start a new tab.
        </p>
        <ErrorBanner error={close.error ? errorMessage(close.error) : null} />
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmClose(false)}>
            Cancel
          </Button>
          <Button className="flex-1" busy={close.isPending} onClick={() => close.mutate()}>
            Close table
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Row({
  label,
  kobo,
  strong,
  muted,
}: {
  label: string;
  kobo: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex justify-between',
        strong && 'text-base font-bold',
        muted && 'text-slate-500',
      )}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">
        {kobo < 0 ? '−' : ''}
        <Money kobo={Math.abs(kobo)} />
      </dd>
    </div>
  );
}
