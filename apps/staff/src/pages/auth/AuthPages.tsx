import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { DeviceInfoDto } from '@app/shared';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import { resetSocket } from '../../lib/socket';
import { Button, Card, ErrorBanner, Field, Input, Loading } from '../../components/ui';

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-md">
        <p className="mb-6 text-center text-sm font-semibold uppercase tracking-widest text-brand-500">
          QR Ordering
        </p>
        <Card className="p-6">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </div>
  );
}

function useSignedIn() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    resetSocket();
    await qc.invalidateQueries({ queryKey: ['me'] });
    navigate('/', { replace: true });
  };
}

export function useDeviceInfo() {
  return useQuery({
    queryKey: ['device'],
    queryFn: async () => {
      try {
        return await get<DeviceInfoDto>('/v1/auth/device');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

/** Signed-out landing: PIN pad on enabled devices, email login otherwise. */
export function AuthLanding() {
  const device = useDeviceInfo();
  if (device.isLoading) return <Loading />;
  if (device.data) return <PinLogin device={device.data} />;
  return <LoginPage />;
}

export function LoginPage() {
  const signedIn = useSignedIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => post('/v1/auth/login', { email, password }),
    onSuccess: signedIn,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };
  return (
    <AuthShell
      title="Sign in"
      subtitle="Owners and managers sign in with email. Staff use the PIN pad on venue devices."
    >
      <form onSubmit={submit} className="space-y-4">
        <ErrorBanner error={login.error ? errorMessage(login.error) : null} />
        <Field label="Email">
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" busy={login.isPending}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        New venue?{' '}
        <Link to="/signup" className="font-semibold text-brand-700 underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function SignupPage() {
  const signedIn = useSignedIn();
  const [form, setForm] = useState({
    ownerName: '',
    email: '',
    password: '',
    pin: '',
    venueName: '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const signup = useMutation({
    mutationFn: () => post('/v1/auth/signup', form),
    onSuccess: signedIn,
  });
  return (
    <AuthShell
      title="Set up your venue"
      subtitle="Takes about a minute. You can change everything later."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          signup.mutate();
        }}
        className="space-y-4"
      >
        <ErrorBanner error={signup.error ? errorMessage(signup.error) : null} />
        <Field label="Venue name">
          {(id) => (
            <Input
              id={id}
              required
              value={form.venueName}
              onChange={set('venueName')}
              placeholder="e.g. Sky Lounge Wuse 2"
            />
          )}
        </Field>
        <Field label="Your name">
          {(id) => (
            <Input
              id={id}
              required
              autoComplete="name"
              value={form.ownerName}
              onChange={set('ownerName')}
            />
          )}
        </Field>
        <Field label="Email">
          {(id) => (
            <Input
              id={id}
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
            />
          )}
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          {(id) => (
            <Input
              id={id}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
            />
          )}
        </Field>
        <Field
          label="Your manager PIN"
          hint="4–6 digits. You'll use it to approve voids and discounts."
        >
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              pattern="\d{4,6}"
              required
              value={form.pin}
              onChange={set('pin')}
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" busy={signup.isPending}>
          Create venue
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-brand-700 underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export function PinPad({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy?: boolean;
}) {
  const press = (d: string) => value.length < 6 && onChange(value + d);
  return (
    <div>
      <div className="mb-4 flex justify-center gap-3" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full ${i < value.length ? 'bg-slate-900' : 'bg-slate-200'}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button
            key={d}
            variant="secondary"
            size="xl"
            onClick={() => press(d)}
            aria-label={`Digit ${d}`}
          >
            {d}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="xl"
          onClick={() => onChange(value.slice(0, -1))}
          aria-label="Delete digit"
        >
          ⌫
        </Button>
        <Button variant="secondary" size="xl" onClick={() => press('0')} aria-label="Digit 0">
          0
        </Button>
        <Button
          variant="success"
          size="xl"
          onClick={onSubmit}
          disabled={value.length < 4}
          busy={busy}
          aria-label="Enter PIN"
        >
          OK
        </Button>
      </div>
    </div>
  );
}

export function PinLogin({ device }: { device: DeviceInfoDto }) {
  const signedIn = useSignedIn();
  const [staffId, setStaffId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const login = useMutation({
    mutationFn: () => post('/v1/auth/pin-login', { staffId, pin }),
    onSuccess: signedIn,
    onError: () => setPin(''),
  });
  const selected = device.staff.find((s) => s.id === staffId);
  return (
    <AuthShell
      title={device.venue.name}
      subtitle={selected ? `Enter PIN for ${selected.name}` : 'Who is signing in?'}
    >
      {!selected ? (
        <div className="space-y-2">
          {device.staff.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStaffId(s.id)}
              className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left ring-1 ring-slate-200 hover:bg-slate-50"
            >
              <span className="font-semibold">{s.name}</span>
              <span className="text-xs uppercase tracking-wide text-slate-500">
                {s.role.toLowerCase()}
              </span>
            </button>
          ))}
          <p className="pt-4 text-center text-sm">
            <Link to="/login" className="text-slate-600 underline">
              Sign in with email instead
            </Link>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <ErrorBanner error={login.error ? errorMessage(login.error) : null} />
          <PinPad
            value={pin}
            onChange={setPin}
            onSubmit={() => login.mutate()}
            busy={login.isPending}
          />
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setStaffId(null);
              setPin('');
              login.reset();
            }}
          >
            ← Choose someone else
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
