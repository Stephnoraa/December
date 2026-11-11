import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { DeviceDto, StaffDto, StaffRole } from '@app/shared';
import { canManageRole } from '@app/shared';
import { errorMessage, get, patch, post } from '../../lib/api';
import { useSession } from '../../lib/session';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Select,
  Toggle,
} from '../../components/ui';
import { formatVenueDateTime } from '@app/shared';

const ROLE_HELP: Record<StaffRole, string> = {
  OWNER: 'Everything, including payouts.',
  MANAGER: 'Menu, tables, staff, approvals and the dashboard.',
  WAITER: 'Floor view, open/close tables, record cash and POS payments.',
  STATION: 'Kitchen or bar screen: accept, unavailable, ready.',
};

export default function Staff() {
  const qc = useQueryClient();
  const { me } = useSession();
  const staff = useQuery({
    queryKey: ['staff'],
    queryFn: () => get<StaffDto[]>('/v1/admin/staff'),
  });
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => get<DeviceDto[]>('/v1/admin/devices'),
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: '',
    role: 'WAITER' as StaffRole,
    pin: '',
    email: '',
    password: '',
  });
  const [pinFor, setPinFor] = useState<StaffDto | null>(null);
  const [newPin, setNewPin] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const refresh = () =>
    Promise.all(
      ['staff', 'devices', 'checklist'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
  const create = useMutation({
    mutationFn: () =>
      post('/v1/admin/staff', {
        name: form.name,
        role: form.role,
        pin: form.pin,
        email: form.role === 'OWNER' || form.role === 'MANAGER' ? form.email || null : null,
        password: form.role === 'OWNER' || form.role === 'MANAGER' ? form.password || null : null,
      }),
    onSuccess: async () => {
      setAdding(false);
      setForm({ name: '', role: 'WAITER', pin: '', email: '', password: '' });
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      patch(`/v1/admin/staff/${v.id}`, v.body),
    onSuccess: refresh,
  });
  const enableDevice = useMutation({
    mutationFn: () => post('/v1/auth/device', { name: deviceName || 'Venue device' }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => post(`/v1/admin/devices/${id}/revoke`),
    onSuccess: refresh,
  });
  const thisDeviceEnabled = enableDevice.isSuccess;

  if (staff.isLoading) return <Loading />;
  const isManagerish = form.role === 'OWNER' || form.role === 'MANAGER';
  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        subtitle="Everyone signs in with a 4–6 digit PIN on venue devices."
        actions={<Button onClick={() => setAdding(true)}>Add staff</Button>}
      />
      <ErrorBanner error={update.error ? errorMessage(update.error) : null} />
      <Card className="divide-y divide-slate-100 p-0">
        {(staff.data ?? []).map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-semibold">
                {s.name}{' '}
                {s.id === me.staff.id && <span className="text-xs text-slate-500">(you)</span>}
              </p>
              <p className="text-sm text-slate-600">
                {s.role.toLowerCase()}
                {s.email && ` · ${s.email}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {s.pinLocked && <Badge tone="red">PIN locked</Badge>}
              {!s.active && <Badge tone="amber">inactive</Badge>}
              {canManageRole(me.staff.role, s.role) && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setPinFor(s)}>
                    {s.pinLocked ? 'Unlock / new PIN' : 'New PIN'}
                  </Button>
                  {s.id !== me.staff.id && (
                    <Toggle
                      label={`${s.name} active`}
                      checked={s.active}
                      onChange={(active) => update.mutate({ id: s.id, body: { active } })}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </Card>

      <div>
        <h2 className="mb-1 text-lg font-bold">Devices</h2>
        <p className="mb-3 text-sm text-slate-600">
          PIN login only works on tablets and phones you enable here. Open this page on the device,
          then enable it.
        </p>
        <Card className="mb-3">
          {thisDeviceEnabled ? (
            <Notice tone="green">This device is enabled. Sign out to show the PIN pad.</Notice>
          ) : (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                enableDevice.mutate();
              }}
            >
              <Input
                aria-label="Device name"
                className="max-w-xs"
                placeholder="Device name, e.g. Bar tablet"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              />
              <Button type="submit" busy={enableDevice.isPending}>
                Enable PIN login on this device
              </Button>
            </form>
          )}
          <div className="mt-2">
            <ErrorBanner error={enableDevice.error ? errorMessage(enableDevice.error) : null} />
          </div>
        </Card>
        <Card className="divide-y divide-slate-100 p-0">
          {(devices.data ?? []).length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-500">No devices yet.</p>
          )}
          {(devices.data ?? []).map((d) => (
            <div key={d.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-semibold">{d.name}</p>
                <p className="text-sm text-slate-600">
                  {d.lastSeenAt
                    ? `Last used ${formatVenueDateTime(d.lastSeenAt)}`
                    : `Enabled ${formatVenueDateTime(d.createdAt)}`}
                </p>
              </div>
              {d.revoked ? (
                <Badge>removed</Badge>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(d.id)}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </Card>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add staff">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <ErrorBanner error={create.error ? errorMessage(create.error) : null} />
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Role" hint={ROLE_HELP[form.role]}>
            {(id) => (
              <Select
                id={id}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
              >
                <option value="WAITER">Waiter</option>
                <option value="STATION">Station screen (kitchen/bar)</option>
                <option value="MANAGER">Manager</option>
                {me.staff.role === 'OWNER' && <option value="OWNER">Owner</option>}
              </Select>
            )}
          </Field>
          <Field label="PIN (4–6 digits)">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                pattern="\d{4,6}"
                required
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value })}
              />
            )}
          </Field>
          {isManagerish && (
            <>
              <Field label="Email (optional)" hint="Lets them sign in from their own phone.">
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                )}
              </Field>
              {form.email && (
                <Field label="Password">
                  {(id) => (
                    <Input
                      id={id}
                      type="password"
                      minLength={8}
                      required
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                  )}
                </Field>
              )}
            </>
          )}
          <Button type="submit" className="w-full" busy={create.isPending}>
            Add
          </Button>
        </form>
      </Modal>

      <Modal
        open={pinFor !== null}
        onClose={() => setPinFor(null)}
        title={`New PIN for ${pinFor?.name ?? ''}`}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pinFor)
              update.mutate(
                { id: pinFor.id, body: { pin: newPin } },
                {
                  onSuccess: () => {
                    setPinFor(null);
                    setNewPin('');
                  },
                },
              );
          }}
        >
          <Field
            label="New PIN"
            hint="This also unlocks a locked PIN and signs them out on all devices."
          >
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                pattern="\d{4,6}"
                required
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" busy={update.isPending}>
            Save PIN
          </Button>
        </form>
      </Modal>
    </div>
  );
}
