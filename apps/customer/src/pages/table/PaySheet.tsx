import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  formatNaira,
  parseNairaToKobo,
  type CustomerSessionDto,
  type PaymentStatusDto,
  type StartPaymentDto,
} from '@app/shared';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import { Alert, Button, cx, Money, Sheet } from '../../components/ui';

const EMAIL_KEY = 'pay-email';

function savedEmail(): string {
  try {
    return window.localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

type Mode = 'FULL' | 'CUSTOM' | 'ORDER';

export function PayButton({ session }: { session: CustomerSessionDto }) {
  const [open, setOpen] = useState(false);
  const awaiting = session.tab.orders.filter((o) => o.status === 'AWAITING_PAYMENT' && o.mine);
  const due = session.tab.totals.balanceKobo > 0 || awaiting.length > 0;
  return (
    <>
      <Button variant="dark" className="px-2 text-sm" disabled={!due} onClick={() => setOpen(true)}>
        💳 Pay
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Pay">
        {open && <PayForm session={session} />}
      </Sheet>
      <PaymentReturn />
    </>
  );
}

function PayForm({ session }: { session: CustomerSessionDto }) {
  const awaiting = session.tab.orders.filter((o) => o.status === 'AWAITING_PAYMENT' && o.mine);
  const balance = session.tab.totals.balanceKobo;
  const [mode, setMode] = useState<Mode>(awaiting.length ? 'ORDER' : 'FULL');
  const [orderId, setOrderId] = useState(awaiting[0]?.id ?? '');
  const [amountText, setAmountText] = useState('');
  const [email, setEmail] = useState(savedEmail);
  const customKobo = parseNairaToKobo(amountText);
  const online = session.venue.onlinePaymentsEnabled;

  const start = useMutation({
    mutationFn: () =>
      post<StartPaymentDto>(
        '/v1/public/session/payments',
        mode === 'ORDER'
          ? { mode, orderId, email }
          : mode === 'CUSTOM'
            ? { mode, amountKobo: customKobo, email }
            : { mode, email },
      ),
    onSuccess: (res) => {
      try {
        window.localStorage.setItem(EMAIL_KEY, email);
      } catch {
        /* ignore */
      }
      window.location.assign(res.authorizationUrl);
    },
  });

  if (!online) {
    return (
      <Alert tone="amber">
        Online payment isn't available here yet. Please pay your waiter by cash or card (POS).
      </Alert>
    );
  }
  const amountKobo =
    mode === 'ORDER'
      ? (awaiting.find((o) => o.id === orderId)?.amountDueKobo ?? 0)
      : mode === 'CUSTOM'
        ? (customKobo ?? 0)
        : balance;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validAmount =
    mode !== 'CUSTOM' || (customKobo !== null && customKobo > 0 && customKobo <= balance);
  const option = (value: Mode, label: string, hint: React.ReactNode) => (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-2xl p-3 ring-1',
        mode === value ? 'bg-brand-50 ring-brand-700' : 'ring-stone-200',
      )}
    >
      <input
        type="radio"
        name="pay-mode"
        className="mt-1 h-5 w-5 accent-brand-700"
        checked={mode === value}
        onChange={() => setMode(value)}
      />
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="text-sm text-stone-600">{hint}</span>
      </span>
    </label>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (validEmail && validAmount && amountKobo > 0) start.mutate();
      }}
    >
      <div className="space-y-2">
        {awaiting.map((o) => (
          <div key={o.id}>
            {option(
              'ORDER',
              `Pay for order #${o.number}`,
              <>
                <Money kobo={o.amountDueKobo ?? 0} /> · sent to the kitchen and bar once paid
              </>,
            )}
          </div>
        ))}
        {balance > 0 && option('FULL', 'Pay the full balance', <Money kobo={balance} />)}
        {balance > 0 &&
          option(
            'CUSTOM',
            'Pay part of the bill',
            'Splitting? Each person pays their share from their own phone.',
          )}
      </div>
      {mode === 'ORDER' && awaiting.length > 1 && (
        <select
          className="w-full rounded-xl px-3 py-3 ring-1 ring-stone-300"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          aria-label="Order to pay"
        >
          {awaiting.map((o) => (
            <option key={o.id} value={o.id}>
              Order #{o.number} · {formatNaira(o.amountDueKobo ?? 0)}
            </option>
          ))}
        </select>
      )}
      {mode === 'CUSTOM' && (
        <label className="block">
          <span className="mb-1 block font-semibold">Amount (₦)</span>
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder={`Up to ${formatNaira(balance)}`}
            className="w-full rounded-xl border-0 px-3 py-3 text-lg ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-700"
          />
          {amountText && !validAmount && (
            <span className="text-sm text-red-700">
              Enter an amount up to {formatNaira(balance)}
            </span>
          )}
        </label>
      )}
      <label className="block">
        <span className="mb-1 block font-semibold">Email for your Paystack receipt</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border-0 px-3 py-3 ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-700"
        />
        <span className="text-xs text-stone-500">
          Paystack requires an email. We only use it for this payment.
        </span>
      </label>
      {start.error && <Alert>{errorMessage(start.error)}</Alert>}
      <Button
        type="submit"
        className="w-full justify-between"
        busy={start.isPending}
        disabled={!validEmail || !validAmount || amountKobo <= 0}
      >
        <span>Pay with card, transfer or USSD</span>
        <Money kobo={amountKobo} />
      </Button>
      <p className="text-center text-xs text-stone-500">
        Secured by Paystack. Your table updates as soon as Paystack confirms.
      </p>
    </form>
  );
}

/** Shown after returning from checkout (?payment=<reference>): waits for server-side confirmation. */
function PaymentReturn() {
  const [params, setParams] = useSearchParams();
  const reference = params.get('payment');
  const qc = useQueryClient();
  const [startedAt] = useState(() => Date.now());
  const status = useQuery({
    queryKey: ['payment', reference],
    queryFn: () => get<PaymentStatusDto>(`/v1/public/payments/${reference}`),
    enabled: Boolean(reference),
    refetchInterval: (q) =>
      q.state.data?.status === 'PENDING' && Date.now() - startedAt < 120_000 ? 2500 : false,
  });
  const cancel = useMutation({
    mutationFn: () => post<PaymentStatusDto>(`/v1/public/payments/${reference}/cancel`),
    onSuccess: () => close(),
  });
  useEffect(() => {
    if (status.data?.status === 'SUCCESS') void qc.invalidateQueries({ queryKey: ['session'] });
  }, [status.data?.status, qc]);
  const close = () => {
    params.delete('payment');
    setParams(params, { replace: true });
  };
  if (!reference) return null;
  const s = status.data?.status;
  const notFound = status.error instanceof ApiError && status.error.status === 404;
  return (
    <Sheet
      open
      onClose={close}
      title={
        s === 'SUCCESS'
          ? 'Payment received'
          : s === 'FAILED'
            ? 'Payment not completed'
            : 'Confirming payment…'
      }
    >
      {notFound ? (
        <Alert>We couldn't find that payment.</Alert>
      ) : s === 'SUCCESS' ? (
        <div className="space-y-3">
          <Alert tone="green">
            Paystack confirmed <Money kobo={status.data!.amountKobo} />. Thank you!
            {status.data!.tabBalanceKobo > 0 ? (
              <>
                {' '}
                Remaining on the table: <Money kobo={status.data!.tabBalanceKobo} />.
              </>
            ) : (
              ' Your table is fully paid.'
            )}
          </Alert>
          <a
            href={`/r/${status.data!.receiptToken}`}
            className="block rounded-2xl bg-brand-700 px-4 py-3 text-center font-semibold text-white"
          >
            View receipt
          </a>
          <Button variant="secondary" className="w-full" onClick={close}>
            Back to my table
          </Button>
        </div>
      ) : s === 'FAILED' ? (
        <div className="space-y-3">
          <Alert>
            The payment didn't go through. You haven't been charged by us. You can try again or pay
            your waiter.
          </Alert>
          <Button className="w-full" onClick={close}>
            OK
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-stone-600">
            Waiting for Paystack to confirm your payment. Bank transfers can take a minute.
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-700" />
          </div>
          <Button
            variant="secondary"
            className="w-full"
            busy={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            I didn't pay, cancel
          </Button>
        </div>
      )}
    </Sheet>
  );
}
