import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { formatNaira, koboToNairaInput, parseNairaToKobo, type StaffTabDto } from '@app/shared';
import { api, errorMessage } from '../../lib/api';
import { Button, cx, ErrorBanner, Field, Input, Money, Notice } from '../../components/ui';

/** Waiter records a cash or POS-terminal payment against the tab (or a held PREPAY order). */
export function RecordPayment({
  data,
  onDone,
}: {
  data: StaffTabDto;
  onDone: () => void | Promise<void>;
}) {
  const balance = data.tab.totals.balanceKobo;
  const held = data.tab.orders.filter((o) => o.status === 'AWAITING_PAYMENT');
  const [method, setMethod] = useState<'CASH' | 'POS'>('CASH');
  const [target, setTarget] = useState<string>(
    balance > 0 ? 'balance' : (held[0]?.id ?? 'balance'),
  );
  const heldOrder = held.find((o) => o.id === target);
  const [amount, setAmount] = useState(koboToNairaInput(heldOrder?.amountDueKobo ?? balance));
  const [key] = useState(() => crypto.randomUUID());
  const amountKobo = heldOrder ? (heldOrder.amountDueKobo ?? 0) : parseNairaToKobo(amount);
  const record = useMutation({
    mutationFn: () =>
      api('/v1/staff/sessions/' + data.tableSession.id + '/payments', {
        method: 'POST',
        idempotencyKey: key,
        body: { method, amountKobo, ...(heldOrder ? { orderId: heldOrder.id } : {}) },
      }),
    onSuccess: onDone,
  });
  const valid = amountKobo !== null && amountKobo > 0 && (heldOrder ? true : amountKobo <= balance);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) record.mutate();
      }}
    >
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment method">
        {(['CASH', 'POS'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => setMethod(m)}
            className={cx(
              'rounded-2xl px-4 py-4 text-lg font-bold ring-2',
              method === m ? 'bg-slate-900 text-white ring-slate-900' : 'ring-slate-200',
            )}
          >
            {m === 'CASH' ? '💵 Cash' : '💳 POS terminal'}
          </button>
        ))}
      </div>
      {held.length > 0 && (
        <Field label="What is being paid?">
          {(id) => (
            <select
              id={id}
              className="block w-full rounded-xl px-3 py-2.5 ring-1 ring-slate-300"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                const o = held.find((h) => h.id === e.target.value);
                setAmount(koboToNairaInput(o?.amountDueKobo ?? balance));
              }}
            >
              {balance > 0 && <option value="balance">Tab balance · {formatNaira(balance)}</option>}
              {held.map((o) => (
                <option key={o.id} value={o.id}>
                  Order #{o.number} (awaiting payment) · {formatNaira(o.amountDueKobo ?? 0)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {heldOrder ? (
        <Notice>
          Collect exactly <Money kobo={heldOrder.amountDueKobo ?? 0} className="font-bold" />. The
          order goes to the kitchen and bar when recorded.
        </Notice>
      ) : (
        <Field
          label="Amount received (₦)"
          hint={
            <>
              Balance: {formatNaira(balance)}. For cash above the balance, record the balance and
              give change.
            </>
          }
        >
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-lg"
            />
          )}
        </Field>
      )}
      <ErrorBanner error={record.error ? errorMessage(record.error) : null} />
      <Button
        type="submit"
        size="lg"
        variant="success"
        className="w-full"
        busy={record.isPending}
        disabled={!valid}
      >
        Record {method === 'CASH' ? 'cash' : 'POS'} {amountKobo ? formatNaira(amountKobo) : ''}
      </Button>
    </form>
  );
}
