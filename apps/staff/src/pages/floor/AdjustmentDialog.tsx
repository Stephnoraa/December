import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatNaira, parseNairaToKobo, type StaffRole, type TabDto } from '@app/shared';
import { api, errorMessage, get } from '../../lib/api';
import { PinPad } from '../auth/AuthPages';
import { Button, cx, ErrorBanner, Field, Input, Notice, Select } from '../../components/ui';

type Target = { orderItemId?: string; type: 'VOID' | 'DISCOUNT' };

/** Void or discount, approved on this device with a manager/owner PIN and a reason. */
export function AdjustmentDialog({
  tableSessionId,
  target,
  tab,
  onDone,
}: {
  tableSessionId: string;
  target: Target;
  tab: TabDto;
  onDone: () => void | Promise<void>;
}) {
  const approvers = useQuery({
    queryKey: ['approvers'],
    queryFn: () => get<{ id: string; name: string; role: StaffRole }[]>('/v1/staff/approvers'),
  });
  const items = tab.orders
    .filter((o) => o.status === 'PLACED')
    .flatMap((o) => o.items.filter((i) => i.billable));
  const [step, setStep] = useState<'details' | 'approve'>('details');
  const [kind, setKind] = useState<'AMOUNT' | 'PERCENT'>('PERCENT');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState(target.orderItemId ?? '');
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');
  const [pin, setPin] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const item = items.find((i) => i.id === (target.type === 'VOID' ? target.orderItemId : scope));
  const amountKobo = kind === 'AMOUNT' ? parseNairaToKobo(value) : null;
  const percentBps =
    kind === 'PERCENT' && /^\d{1,3}(\.\d{1,2})?$/.test(value)
      ? Math.round(Number(value) * 100)
      : null;
  const validDetails =
    reason.trim().length >= 3 &&
    (target.type === 'VOID'
      ? Boolean(item)
      : kind === 'AMOUNT'
        ? (amountKobo ?? 0) > 0
        : (percentBps ?? 0) > 0 && (percentBps ?? 0) <= 10_000);

  const submit = useMutation({
    mutationFn: () =>
      api(`/v1/staff/sessions/${tableSessionId}/adjustments`, {
        method: 'POST',
        idempotencyKey: key,
        body:
          target.type === 'VOID'
            ? {
                type: 'VOID',
                orderItemId: target.orderItemId,
                reason,
                approver: { staffId: approverId, pin },
              }
            : {
                type: 'DISCOUNT',
                kind,
                ...(kind === 'AMOUNT' ? { amountKobo } : { percentBps }),
                ...(scope ? { orderItemId: scope } : {}),
                reason,
                approver: { staffId: approverId, pin },
              },
      }),
    onSuccess: onDone,
    onError: () => setPin(''),
  });

  if (step === 'approve') {
    return (
      <div className="space-y-4">
        <Notice tone="amber">
          {target.type === 'VOID'
            ? `Void ${item?.quantity}× ${item?.name} (${formatNaira(item?.lineTotalKobo ?? 0)})`
            : `Discount ${kind === 'PERCENT' ? `${value}%` : formatNaira(amountKobo ?? 0)}${item ? ` on ${item.name}` : ' on the whole bill'}`}
          {' · '}“{reason}”
        </Notice>
        <Field label="Approved by">
          {(id) => (
            <Select id={id} value={approverId} onChange={(e) => setApproverId(e.target.value)}>
              <option value="">Choose manager or owner</option>
              {(approvers.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role.toLowerCase()})
                </option>
              ))}
            </Select>
          )}
        </Field>
        {approverId && (
          <>
            <p className="text-center text-sm font-medium text-slate-700">
              Manager enters their PIN
            </p>
            <PinPad
              value={pin}
              onChange={setPin}
              onSubmit={() => submit.mutate()}
              busy={submit.isPending}
            />
          </>
        )}
        <ErrorBanner
          error={
            submit.error
              ? errorMessage(submit.error)
              : approvers.error
                ? errorMessage(approvers.error)
                : null
          }
        />
        <Button variant="ghost" className="w-full" onClick={() => setStep('details')}>
          ← Back
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (validDetails) setStep('approve');
      }}
    >
      {target.type === 'VOID' ? (
        <Notice>
          Remove <strong>{item ? `${item.quantity}× ${item.name}` : 'item'}</strong> (
          {formatNaira(item?.lineTotalKobo ?? 0)}) from the bill.
        </Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Discount type">
            {(['PERCENT', 'AMOUNT'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cx(
                  'rounded-xl px-3 py-3 font-semibold ring-2',
                  kind === k ? 'bg-slate-900 text-white ring-slate-900' : 'ring-slate-200',
                )}
              >
                {k === 'PERCENT' ? 'Percent %' : 'Amount ₦'}
              </button>
            ))}
          </div>
          <Field label={kind === 'PERCENT' ? 'Discount %' : 'Discount amount (₦)'}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </Field>
          <Field label="Applies to">
            {(id) => (
              <Select id={id} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">Whole bill</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.quantity}× {i.name} ({formatNaira(i.lineTotalKobo)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      )}
      <Field label="Reason" hint="Shown in the audit log and on the owner's dashboard.">
        {(id) => (
          <Input
            id={id}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Spilled before serving"
          />
        )}
      </Field>
      <Button type="submit" className="w-full" disabled={!validDetails}>
        Continue to manager approval
      </Button>
    </form>
  );
}
