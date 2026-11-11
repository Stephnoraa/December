import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { StationDto } from '@app/shared';
import { errorMessage, get, patch, post } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Input,
  Loading,
  PageHeader,
  Toggle,
} from '../../components/ui';

export default function Stations() {
  const qc = useQueryClient();
  const stations = useQuery({
    queryKey: ['stations'],
    queryFn: () => get<StationDto[]>('/v1/admin/stations'),
  });
  const [name, setName] = useState('');
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['stations'] }),
      qc.invalidateQueries({ queryKey: ['checklist'] }),
    ]);
  const create = useMutation({
    mutationFn: () => post('/v1/admin/stations', { name }),
    onSuccess: async () => {
      setName('');
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: (s: { id: string; active: boolean }) =>
      patch(`/v1/admin/stations/${s.id}`, { active: s.active }),
    onSuccess: refresh,
  });
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Stations"
        subtitle="Each menu item is sent to one station's screen, e.g. Kitchen or Bar."
      />
      <Card className="mb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input
            aria-label="New station name"
            placeholder="New station, e.g. Grill"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" busy={create.isPending}>
            Add
          </Button>
        </form>
        <div className="mt-2">
          <ErrorBanner
            error={
              create.error
                ? errorMessage(create.error)
                : update.error
                  ? errorMessage(update.error)
                  : null
            }
          />
        </div>
      </Card>
      {stations.isLoading ? (
        <Loading />
      ) : !stations.data?.length ? (
        <EmptyState title="No stations yet">Add Kitchen and Bar to start.</EmptyState>
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {stations.data.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{s.name}</span>
                {!s.active && <Badge>inactive</Badge>}
              </div>
              <Toggle
                label={`${s.name} active`}
                checked={s.active}
                onChange={(active) => update.mutate({ id: s.id, active })}
              />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
