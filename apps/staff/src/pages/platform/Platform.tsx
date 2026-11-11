import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatVenueDateTime, type PlatformVenueDto } from '@app/shared';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Input,
  Loading,
  PageHeader,
} from '../../components/ui';

/** Super-admin (operator) screen: list venues, setup status, suspend / activate. */
export default function Platform() {
  const me = useQuery({
    queryKey: ['platform-me'],
    queryFn: async () => {
      try {
        return await get<{ id: string; email: string }>('/v1/platform/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
  if (me.isLoading) return <Loading />;
  return me.data ? <Venues email={me.data.email} /> : <PlatformLogin />;
}

function PlatformLogin() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => post('/v1/platform/auth/login', { email, password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-me'] }),
  });
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-900 p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-4 text-xl font-bold">Platform operator</h1>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <ErrorBanner error={login.error ? errorMessage(login.error) : null} />
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
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
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" busy={login.isPending}>
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}

function Venues({ email }: { email: string }) {
  const qc = useQueryClient();
  const venues = useQuery({
    queryKey: ['platform-venues'],
    queryFn: () => get<PlatformVenueDto[]>('/v1/platform/venues'),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; action: 'suspend' | 'activate' }) =>
      post(`/v1/platform/venues/${v.id}/${v.action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-venues'] }),
  });
  const logout = useMutation({
    mutationFn: () => post('/v1/platform/auth/logout'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-me'] }),
  });
  return (
    <div className="mx-auto max-w-5xl p-4">
      <PageHeader
        title="Venues"
        subtitle={`Signed in as ${email}. Subscriptions are billed outside the app.`}
        actions={
          <Button variant="secondary" onClick={() => logout.mutate()}>
            Sign out
          </Button>
        }
      />
      <ErrorBanner error={setStatus.error ? errorMessage(setStatus.error) : null} />
      {venues.isLoading ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          {(venues.data ?? []).map((v) => {
            const done = v.checklist.items.filter((i) => i.done).length;
            return (
              <Card key={v.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold">
                      {v.name} <span className="text-sm font-normal text-slate-500">/{v.slug}</span>
                    </p>
                    <p className="text-sm text-slate-600">
                      {v.ownerName ?? 'No owner'} {v.ownerEmail && `· ${v.ownerEmail}`} · joined{' '}
                      {formatVenueDateTime(v.createdAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {v.status === 'ACTIVE' ? (
                        <Badge tone="green">active</Badge>
                      ) : (
                        <Badge tone="red">suspended</Badge>
                      )}
                      {v.checklist.ready ? (
                        <Badge tone="green">ready to go live</Badge>
                      ) : (
                        <Badge tone="amber">
                          setup {done}/{v.checklist.items.length}
                        </Badge>
                      )}
                      <Badge>{v.ordersToday} orders today</Badge>
                    </div>
                    {!v.checklist.ready && (
                      <p className="mt-2 text-xs text-slate-500">
                        Missing:{' '}
                        {v.checklist.items
                          .filter((i) => i.required && !i.done)
                          .map((i) => i.label)
                          .join(', ')}
                      </p>
                    )}
                  </div>
                  {v.status === 'ACTIVE' ? (
                    <Button
                      variant="danger"
                      size="sm"
                      busy={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: v.id, action: 'suspend' })}
                    >
                      Suspend
                    </Button>
                  ) : (
                    <Button
                      variant="success"
                      size="sm"
                      busy={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: v.id, action: 'activate' })}
                    >
                      Activate
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
