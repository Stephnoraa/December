import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import type { VenueSettingsDto } from '@app/shared';
import { errorMessage, get, patch, post, uploadImage } from '../lib/api';
import {
  Button,
  Card,
  cx,
  ErrorBanner,
  Field,
  Input,
  Loading,
  Notice,
  PageHeader,
  Select,
  Toggle,
} from '../components/ui';
import { Payouts } from './Payouts';

export function useVenueSettings() {
  return useQuery({ queryKey: ['venue'], queryFn: () => get<VenueSettingsDto>('/v1/admin/venue') });
}

const pct = (bps: number) => String(bps / 100);
const toBps = (text: string) => Math.round(Number(text) * 100);

function General({ venue }: { venue: VenueSettingsDto }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: venue.name,
    address: venue.address ?? '',
    paymentMode: venue.paymentMode,
    vat: pct(venue.vatBps),
    service: pct(venue.serviceChargeBps),
    pricesIncludeVat: venue.pricesIncludeVat,
  });
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [form]);
  const save = useMutation({
    mutationFn: () =>
      patch<VenueSettingsDto>('/v1/admin/venue', {
        name: form.name,
        address: form.address.trim() || null,
        paymentMode: form.paymentMode,
        vatBps: toBps(form.vat),
        serviceChargeBps: toBps(form.service),
        pricesIncludeVat: form.pricesIncludeVat,
      }),
    onSuccess: async () => {
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['venue'] });
      await qc.invalidateQueries({ queryKey: ['checklist'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const logo = useMutation({
    mutationFn: async (file: File) => {
      const uploadKey = await uploadImage('/v1/admin/venue/logo/upload-url', file);
      return post<VenueSettingsDto>('/v1/admin/venue/logo', { uploadKey });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['venue'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const validRate = (t: string) =>
    t !== '' && Number(t) >= 0 && Number(t) <= 100 && /^\d+(\.\d{1,2})?$/.test(t);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <ErrorBanner error={save.error ? errorMessage(save.error) : null} />
          {saved && <Notice tone="green">Settings saved.</Notice>}
          <Field label="Venue name">
            {(id) => (
              <Input
                id={id}
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Address (shown on receipts)">
            {(id) => (
              <Input
                id={id}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="e.g. Wuse 2, Abuja"
              />
            )}
          </Field>
          <Field
            label="When do customers pay?"
            hint={
              form.paymentMode === 'PREPAY'
                ? 'Orders reach the kitchen and bar only after the customer pays.'
                : 'Orders go straight to the kitchen and bar; the tab is paid at the end.'
            }
          >
            {(id) => (
              <Select
                id={id}
                value={form.paymentMode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    paymentMode: e.target.value as VenueSettingsDto['paymentMode'],
                  })
                }
              >
                <option value="POSTPAY">Pay at the end (running tab)</option>
                <option value="PREPAY">Pay before the order is sent</option>
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="VAT %"
              error={validRate(form.vat) ? null : 'Enter a percentage between 0 and 100'}
            >
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={form.vat}
                  onChange={(e) => setForm({ ...form, vat: e.target.value })}
                />
              )}
            </Field>
            <Field
              label="Service charge %"
              error={validRate(form.service) ? null : 'Enter a percentage between 0 and 100'}
            >
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={form.service}
                  onChange={(e) => setForm({ ...form, service: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-3">
            <div>
              <p className="font-medium">Menu prices include VAT</p>
              <p className="text-sm text-slate-600">
                {form.pricesIncludeVat
                  ? 'The menu price is what the customer pays (plus any service charge).'
                  : 'VAT is added on top of menu prices on the bill.'}
              </p>
            </div>
            <Toggle
              label="Menu prices include VAT"
              checked={form.pricesIncludeVat}
              onChange={(v) => setForm({ ...form, pricesIncludeVat: v })}
            />
          </div>
          <p className="text-xs text-slate-500">
            Changes apply to tables opened from now on. Open tabs keep the charges they started
            with.
          </p>
          <Button
            type="submit"
            busy={save.isPending}
            disabled={!validRate(form.vat) || !validRate(form.service)}
          >
            Save settings
          </Button>
        </form>
      </Card>
      <Card>
        <h2 className="font-bold">Logo</h2>
        <p className="mb-3 text-sm text-slate-600">Shown on the customer menu and receipts.</p>
        {venue.logoUrl ? (
          <img
            src={venue.logoUrl}
            alt="Venue logo"
            className="mb-3 h-28 w-28 rounded-2xl object-cover ring-1 ring-slate-200"
          />
        ) : (
          <div className="mb-3 flex h-28 w-28 items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500">
            No logo
          </div>
        )}
        <ErrorBanner error={logo.error ? errorMessage(logo.error) : null} />
        <label className="mt-2 inline-flex cursor-pointer items-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold ring-1 ring-slate-300 hover:bg-slate-50">
          {logo.isPending ? 'Uploading…' : 'Upload logo'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) logo.mutate(f);
              e.target.value = '';
            }}
          />
        </label>
      </Card>
    </div>
  );
}

export default function Settings() {
  const venue = useVenueSettings();
  const tab = (to: string, label: string) => (
    <NavLink
      end
      to={to}
      className={({ isActive }) =>
        cx(
          'rounded-lg px-3 py-1.5 text-sm font-semibold',
          isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200',
        )
      }
    >
      {label}
    </NavLink>
  );
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle={venue.data ? `Customer menu link: /t/${venue.data.slug}/…` : undefined}
      />
      <div className="mb-4 flex gap-2">
        {tab('/settings', 'Venue & charges')}
        {tab('/settings/payouts', 'Payouts')}
      </div>
      {venue.isLoading || !venue.data ? (
        <Loading />
      ) : (
        <Routes>
          <Route index element={<General key={venue.data.id} venue={venue.data} />} />
          <Route path="payouts" element={<Payouts venue={venue.data} />} />
        </Routes>
      )}
    </div>
  );
}
