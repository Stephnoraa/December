import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatVenueTime, SocketEvent, type DashboardDto, type PaymentBucket } from '@app/shared';
import { get } from '../lib/api';
import { useSocketEvents } from '../lib/socket';
import { Badge, Card, EmptyState, Loading, Money, PageHeader } from '../components/ui';
import { SetupChecklist, useChecklist } from './Checklist';

const BUCKETS: { key: PaymentBucket; label: string }[] = [
  { key: 'CARD', label: 'Card' },
  { key: 'TRANSFER', label: 'Bank transfer' },
  { key: 'USSD', label: 'USSD' },
  { key: 'CASH', label: 'Cash' },
  { key: 'POS', label: 'POS terminal' },
  { key: 'OTHER_ONLINE', label: 'Other online' },
];

export default function Dashboard() {
  const qc = useQueryClient();
  const checklist = useChecklist();
  const dash = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => get<DashboardDto>('/v1/admin/dashboard'),
    refetchInterval: 60_000,
  });
  useSocketEvents(
    [
      SocketEvent.TAB_UPDATED,
      SocketEvent.PAYMENT_UPDATED,
      SocketEvent.TABLE_SESSION_OPENED,
      SocketEvent.TABLE_SESSION_CLOSED,
    ],
    () => void qc.invalidateQueries({ queryKey: ['dashboard'] }),
  );
  const d = dash.data;
  const showChecklist = checklist.data && !checklist.data.ready;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle={
          d ? `Today since ${formatVenueTime(d.businessDayStart)} · updates live` : undefined
        }
      />
      {showChecklist && <SetupChecklist checklist={checklist.data!} />}
      {dash.isLoading || !d ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <p className="text-sm text-slate-600">Sales today (collected)</p>
              <p className="mt-1 text-3xl font-black">
                <Money kobo={d.salesTodayKobo} />
              </p>
              <p className="text-sm text-slate-500">{d.paymentsToday} payments</p>
            </Card>
            <Card>
              <p className="text-sm text-slate-600">Open tabs</p>
              <p className="mt-1 text-3xl font-black">{d.openTabs.length}</p>
              <p className="text-sm text-slate-500">
                <Money kobo={d.openTabsBalanceKobo} /> still to collect
              </p>
            </Card>
            <Card>
              <p className="text-sm text-slate-600">Voids & discounts today</p>
              <p className="mt-1 text-3xl font-black">{d.adjustmentsToday.length}</p>
              <p className="text-sm text-slate-500">
                <Money kobo={d.adjustmentsToday.reduce((s, a) => s + a.appliedKobo, 0)} /> taken off
                bills
              </p>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-2 font-bold">Payments by method</h2>
              <dl className="divide-y divide-slate-100">
                {BUCKETS.filter((b) => b.key !== 'OTHER_ONLINE' || d.byBucket.OTHER_ONLINE > 0).map(
                  (b) => (
                    <div key={b.key} className="flex justify-between py-2">
                      <dt>{b.label}</dt>
                      <dd className="font-semibold">
                        <Money kobo={d.byBucket[b.key]} />
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </Card>
            <Card>
              <h2 className="mb-2 font-bold">Open tabs</h2>
              {d.openTabs.length === 0 ? (
                <p className="text-sm text-slate-500">No open tables.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {d.openTabs.map((t) => (
                    <li key={t.tabId}>
                      <Link
                        to={`/floor/sessions/${t.tableSessionId}`}
                        className="flex items-center justify-between py-2 hover:bg-slate-50"
                      >
                        <span>
                          <strong>Table {t.tableLabel}</strong>{' '}
                          <span className="text-sm text-slate-500">
                            since {formatVenueTime(t.openedAt)}
                          </span>
                        </span>
                        <span className="text-right text-sm">
                          {t.balanceKobo > 0 ? (
                            <>
                              <Money kobo={t.balanceKobo} className="font-bold" /> due of{' '}
                              <Money kobo={t.totalKobo} />
                            </>
                          ) : (
                            <Badge tone="green">paid</Badge>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card>
            <h2 className="mb-2 font-bold">Voids and discounts today</h2>
            {d.adjustmentsToday.length === 0 ? (
              <EmptyState title="None today" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Reason</th>
                      <th className="py-2 pr-3 font-medium">Requested by</th>
                      <th className="py-2 pr-3 font-medium">Approved by</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.adjustmentsToday.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2 pr-3">{formatVenueTime(a.createdAt)}</td>
                        <td className="py-2 pr-3">
                          {a.type === 'VOID' ? (
                            <Badge tone="red">void</Badge>
                          ) : (
                            <Badge tone="amber">
                              {a.discountKind === 'PERCENT'
                                ? `${(a.percentBps ?? 0) / 100}% off`
                                : 'discount'}
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3">{a.reason}</td>
                        <td className="py-2 pr-3">{a.requestedBy.name}</td>
                        <td className="py-2 pr-3 font-semibold">{a.approvedBy.name}</td>
                        <td className="py-2 text-right">
                          −<Money kobo={a.appliedKobo} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {d.refundsDue.length > 0 && (
            <Card className="ring-amber-300">
              <h2 className="mb-1 font-bold">Refunds due</h2>
              <p className="mb-2 text-sm text-slate-600">
                More was collected than owed (e.g. two people paid the same balance, or a prepaid
                item was unavailable). Refund from your Paystack dashboard or in cash.
              </p>
              <ul className="space-y-1 text-sm">
                {d.refundsDue.map((r) => (
                  <li key={r.paymentId} className="flex justify-between">
                    <span>
                      Table {r.tableLabel}{' '}
                      {r.reference && <span className="text-slate-500">· ref {r.reference}</span>}
                    </span>
                    <Money kobo={r.overpaidKobo} className="font-bold" />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {checklist.data?.ready && (
            <p className="text-center text-sm text-slate-500">
              Setup complete.{' '}
              <Link to="/settings" className="underline">
                Settings
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
