import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Permission, type BankDto, type VenueSettingsDto } from '@app/shared';
import { errorMessage, get, post } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Card, ErrorBanner, Field, Input, Notice, Select } from '../components/ui';

/** Paystack payout onboarding: pick bank, resolve the account name, create the venue sub-account. */
export function Payouts({ venue }: { venue: VenueSettingsDto }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const owner = can(Permission.VENUE_PAYOUT);
  const [editing, setEditing] = useState(!venue.payout.configured);
  const banks = useQuery({
    queryKey: ['banks'],
    queryFn: () => get<BankDto[]>('/v1/admin/payout/banks'),
    enabled: owner && editing,
    staleTime: 3600_000,
  });
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const bankName = banks.data?.find((b) => b.code === bankCode)?.name ?? '';
  const resolve = useMutation({
    mutationFn: () =>
      post<{ accountName: string }>('/v1/admin/payout/resolve', { bankCode, accountNumber }),
  });
  const save = useMutation({
    mutationFn: () => post('/v1/admin/payout', { bankCode, bankName, accountNumber }),
    onSuccess: async () => {
      setEditing(false);
      await Promise.all(['venue', 'checklist'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    },
  });
  const ready = bankCode && /^\d{10}$/.test(accountNumber);
  return (
    <Card className="max-w-xl space-y-4">
      <div>
        <h2 className="text-lg font-bold">Payout bank account</h2>
        <p className="text-sm text-slate-600">
          Online payments (card, transfer, USSD) settle to this account through Paystack. Paystack's
          fees are deducted from each payment.
        </p>
      </div>
      {venue.payout.configured && (
        <Notice tone="green">
          Payouts go to <strong>{venue.payout.accountName}</strong> · {venue.payout.bankName}{' '}
          {venue.payout.accountNumberMasked}
        </Notice>
      )}
      {!owner ? (
        <Notice tone="amber">Only the owner can change the payout account.</Notice>
      ) : !editing ? (
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Change payout account
        </Button>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (resolve.data) save.mutate();
            else if (ready) resolve.mutate();
          }}
        >
          <ErrorBanner
            error={
              banks.error
                ? errorMessage(banks.error)
                : resolve.error
                  ? errorMessage(resolve.error)
                  : save.error
                    ? errorMessage(save.error)
                    : null
            }
          />
          <Field label="Bank">
            {(id) => (
              <Select
                id={id}
                value={bankCode}
                onChange={(e) => {
                  setBankCode(e.target.value);
                  resolve.reset();
                }}
                disabled={banks.isLoading}
              >
                <option value="">{banks.isLoading ? 'Loading banks…' : 'Choose your bank'}</option>
                {(banks.data ?? []).map((b) => (
                  <option key={`${b.code}-${b.name}`} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Account number (10 digits)">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                maxLength={10}
                value={accountNumber}
                onChange={(e) => {
                  setAccountNumber(e.target.value.replace(/\D/g, ''));
                  resolve.reset();
                }}
              />
            )}
          </Field>
          {resolve.data && (
            <Notice tone="green">
              Account name: <strong>{resolve.data.accountName}</strong>. Is this your business
              account?
            </Notice>
          )}
          <div className="flex gap-2">
            {resolve.data ? (
              <Button type="submit" busy={save.isPending}>
                Yes, use this account
              </Button>
            ) : (
              <Button type="submit" busy={resolve.isPending} disabled={!ready}>
                Check account name
              </Button>
            )}
            {venue.payout.configured && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
