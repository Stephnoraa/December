import { formatVenueTime, type OrderItemStatus, type TabDto } from '@app/shared';
import { cx, Money } from '../../components/ui';

const STATUS: Record<OrderItemStatus, { label: string; tone: string }> = {
  SENT: { label: 'Sent', tone: 'bg-sky-100 text-sky-800' },
  ACCEPTED: { label: 'Accepted', tone: 'bg-indigo-100 text-indigo-800' },
  UNAVAILABLE: { label: 'Unavailable', tone: 'bg-red-100 text-red-800' },
  READY: { label: 'Ready', tone: 'bg-amber-100 text-amber-900' },
  SERVED: { label: 'Served', tone: 'bg-emerald-100 text-emerald-800' },
  VOIDED: { label: 'Removed', tone: 'bg-stone-200 text-stone-700' },
};

export function StatusChip({
  status,
  awaitingPayment,
}: {
  status: OrderItemStatus;
  awaitingPayment?: boolean;
}) {
  const s = awaitingPayment
    ? { label: 'Awaiting payment', tone: 'bg-amber-100 text-amber-900' }
    : STATUS[status];
  return (
    <span className={cx('rounded-full px-2.5 py-1 text-xs font-bold', s.tone)}>{s.label}</span>
  );
}

export function TotalsTable({ tab }: { tab: TabDto }) {
  const t = tab.totals;
  const row = (label: string, kobo: number, strong = false, negative = false) => (
    <div className={cx('flex justify-between py-1', strong && 'text-lg font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">
        {negative ? '−' : ''}
        <Money kobo={kobo} />
      </span>
    </div>
  );
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-stone-200">
      {row('Subtotal', t.subtotalKobo)}
      {t.discountKobo > 0 && row('Discounts', t.discountKobo, false, true)}
      {t.serviceChargeKobo > 0 &&
        row(`Service charge (${t.serviceChargeBps / 100}%)`, t.serviceChargeKobo)}
      {t.pricesIncludeVat
        ? t.vatKobo > 0 && (
            <div className="flex justify-between py-1 text-sm text-stone-500">
              <span>VAT {t.vatBps / 100}% (included)</span>
              <Money kobo={t.vatKobo} />
            </div>
          )
        : row(`VAT (${t.vatBps / 100}%)`, t.vatKobo)}
      <div className="my-2 border-t border-stone-200" />
      {row('Total', t.totalKobo, true)}
      {t.paidKobo > 0 && row('Paid', t.paidKobo)}
      <div
        className={cx(
          'mt-1 flex justify-between rounded-xl px-3 py-2 text-lg font-bold',
          t.balanceKobo > 0 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800',
        )}
      >
        <span>{t.balanceKobo > 0 ? 'Balance due' : 'All paid'}</span>
        <Money kobo={t.balanceKobo} />
      </div>
      {t.overpaidKobo > 0 && (
        <p className="mt-2 text-sm text-stone-600">
          Overpaid by <Money kobo={t.overpaidKobo} />: staff will arrange a refund.
        </p>
      )}
    </div>
  );
}

export function TabView({ tab }: { tab: TabDto }) {
  if (tab.orders.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-center text-stone-600 ring-1 ring-stone-200">
        No orders yet. Pick something from the menu.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {tab.orders.map((o) => (
        <section
          key={o.id}
          className="rounded-2xl bg-white p-4 ring-1 ring-stone-200"
          aria-label={`Order ${o.number}`}
        >
          <div className="mb-2 flex items-center justify-between text-sm text-stone-500">
            <span className="font-semibold text-stone-800">
              Order #{o.number} {o.mine ? '· you' : o.byStaff ? '· staff' : ''}
            </span>
            <span>{formatVenueTime(o.createdAt)}</span>
          </div>
          <ul className="divide-y divide-stone-100">
            {o.items.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 py-2">
                <div
                  className={cx(
                    'min-w-0',
                    !i.billable && o.status === 'PLACED' && 'text-stone-400 line-through',
                  )}
                >
                  <p className="font-medium">
                    {i.quantity}× {i.name}
                  </p>
                  {i.addOns.length > 0 && (
                    <p className="text-sm text-stone-500">
                      {i.addOns.map((a) => a.name).join(', ')}
                    </p>
                  )}
                  {i.note && <p className="text-sm italic text-stone-500">“{i.note}”</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusChip status={i.status} awaitingPayment={o.status === 'AWAITING_PAYMENT'} />
                  <span className="text-sm tabular-nums text-stone-600">
                    {i.billable || o.status === 'AWAITING_PAYMENT' ? (
                      <Money kobo={i.lineTotalKobo} />
                    ) : (
                      'Not charged'
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <TotalsTable tab={tab} />
    </div>
  );
}
