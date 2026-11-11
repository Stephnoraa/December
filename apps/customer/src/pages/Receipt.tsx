import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { formatVenueDateTime, type ReceiptDto } from '@app/shared';
import { errorMessage, get } from '../lib/api';
import { Button, CenteredMessage, MenuSkeleton, Money } from '../components/ui';

const BUCKET_LABEL: Record<string, string> = {
  CARD: 'Card',
  TRANSFER: 'Bank transfer',
  USSD: 'USSD',
  OTHER_ONLINE: 'Online',
  CASH: 'Cash',
  POS: 'POS terminal',
};

export default function Receipt() {
  const { token = '' } = useParams();
  const receipt = useQuery({
    queryKey: ['receipt', token],
    queryFn: () => get<ReceiptDto>(`/v1/public/receipts/${token}`),
  });
  if (receipt.isLoading) return <MenuSkeleton />;
  if (!receipt.data)
    return (
      <CenteredMessage title="Receipt not found">
        {receipt.error ? errorMessage(receipt.error) : null}
      </CenteredMessage>
    );
  const r = receipt.data;
  const t = r.totals;
  const share = async () => {
    const url = window.location.href;
    if (navigator.share)
      await navigator.share({ title: `${r.venue.name} receipt`, url }).catch(() => undefined);
    else await navigator.clipboard?.writeText(url).catch(() => undefined);
  };
  return (
    <main className="mx-auto max-w-md p-4">
      <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
        <header className="mb-4 text-center">
          {r.venue.logoUrl && (
            <img
              src={r.venue.logoUrl}
              alt=""
              className="mx-auto mb-2 h-14 w-14 rounded-2xl object-cover"
            />
          )}
          <h1 className="text-xl font-bold">{r.venue.name}</h1>
          {r.venue.address && <p className="text-sm text-stone-500">{r.venue.address}</p>}
          <p className="mt-1 text-sm text-stone-500">
            Table {r.table.label} · {formatVenueDateTime(r.openedAt)}
          </p>
        </header>
        <ul className="divide-y divide-dashed divide-stone-200 border-y border-dashed border-stone-300">
          {r.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3 py-2 text-sm">
              <span
                className={
                  i.status === 'UNAVAILABLE' || i.status === 'VOIDED'
                    ? 'text-stone-400 line-through'
                    : ''
                }
              >
                {i.quantity}× {i.name}
                {i.addOns.length > 0 && (
                  <span className="block text-xs text-stone-500">{i.addOns.join(', ')}</span>
                )}
              </span>
              <Money
                kobo={i.lineTotalKobo}
                className={
                  i.status === 'UNAVAILABLE' || i.status === 'VOIDED'
                    ? 'text-stone-400 line-through'
                    : ''
                }
              />
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>
              <Money kobo={t.subtotalKobo} />
            </dd>
          </div>
          {r.adjustments
            .filter((a) => a.type === 'DISCOUNT')
            .map((a, i) => (
              <div key={i} className="flex justify-between">
                <dt>Discount ({a.reason})</dt>
                <dd>
                  −<Money kobo={a.appliedKobo} />
                </dd>
              </div>
            ))}
          {t.serviceChargeKobo > 0 && (
            <div className="flex justify-between">
              <dt>Service charge {t.serviceChargeBps / 100}%</dt>
              <dd>
                <Money kobo={t.serviceChargeKobo} />
              </dd>
            </div>
          )}
          <div className="flex justify-between text-stone-600">
            <dt>
              VAT {t.vatBps / 100}%{t.pricesIncludeVat ? ' (included)' : ''}
            </dt>
            <dd>
              <Money kobo={t.vatKobo} />
            </dd>
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-2 text-lg font-bold">
            <dt>Total</dt>
            <dd>
              <Money kobo={t.totalKobo} />
            </dd>
          </div>
          {r.payments.map((p) => (
            <div key={p.reference} className="flex justify-between text-stone-600">
              <dt>Paid · {BUCKET_LABEL[p.bucket] ?? p.bucket}</dt>
              <dd>
                <Money kobo={p.amountKobo} />
              </dd>
            </div>
          ))}
          <div className="flex justify-between font-semibold">
            <dt>Balance</dt>
            <dd>
              <Money kobo={t.balanceKobo} />
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-center text-xs text-stone-500">
          {r.tabStatus === 'OPEN'
            ? 'Table still open: this receipt updates as you order and pay.'
            : 'Thank you for visiting!'}
        </p>
      </article>
      <Button variant="secondary" className="mt-4 w-full" onClick={() => void share()}>
        Share receipt link
      </Button>
    </main>
  );
}
