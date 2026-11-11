import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { TableDto } from '@app/shared';
import { apiUrl, errorMessage, get, patch, post } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Toggle,
} from '../../components/ui';

export default function Tables() {
  const qc = useQueryClient();
  const tables = useQuery({
    queryKey: ['tables'],
    queryFn: () => get<TableDto[]>('/v1/admin/tables'),
  });
  const [adding, setAdding] = useState(false);
  const [single, setSingle] = useState({ label: '', area: '' });
  const [bulk, setBulk] = useState({ prefix: 'T', from: '1', to: '10', area: '' });
  const [confirmRotate, setConfirmRotate] = useState<TableDto | 'all' | null>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['tables'] }),
      qc.invalidateQueries({ queryKey: ['checklist'] }),
    ]);

  const addOne = useMutation({
    mutationFn: () =>
      post('/v1/admin/tables', { label: single.label, area: single.area.trim() || null }),
    onSuccess: async () => {
      setSingle({ label: '', area: single.area });
      await refresh();
    },
  });
  const addBulk = useMutation({
    mutationFn: () =>
      post('/v1/admin/tables/bulk', {
        prefix: bulk.prefix,
        from: Number(bulk.from),
        to: Number(bulk.to),
        area: bulk.area.trim() || null,
      }),
    onSuccess: async () => {
      setAdding(false);
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (t: { id: string; active: boolean }) =>
      patch(`/v1/admin/tables/${t.id}`, { active: t.active }),
    onSuccess: refresh,
  });
  const rotate = useMutation({
    mutationFn: (target: TableDto | 'all') =>
      post('/v1/admin/tables/rotate-qr', target === 'all' ? {} : { tableIds: [target.id] }),
    onSuccess: async () => {
      setConfirmRotate(null);
      await refresh();
    },
  });

  const byArea = useMemo(() => {
    const groups = new Map<string, TableDto[]>();
    for (const t of tables.data ?? []) {
      const key = t.area ?? 'No area';
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    return [...groups.entries()];
  }, [tables.data]);

  const error = addOne.error ?? addBulk.error ?? toggle.error ?? rotate.error;
  return (
    <div>
      <PageHeader
        title="Tables & QR codes"
        subtitle="Print the QR sheet and stick each code on its table. Customers scan it to see the menu."
        actions={
          <>
            <a
              href={apiUrl('/v1/admin/tables/qr.pdf')}
              className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Download QR sheet (PDF)
            </a>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add many tables
            </Button>
          </>
        }
      />
      <ErrorBanner error={error ? errorMessage(error) : null} />
      <Card className="mb-4">
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (single.label.trim()) addOne.mutate();
          }}
        >
          <Input
            aria-label="Table label"
            placeholder="Table label, e.g. M7"
            value={single.label}
            onChange={(e) => setSingle({ ...single, label: e.target.value })}
          />
          <Input
            aria-label="Area"
            placeholder="Area (optional), e.g. Terrace"
            value={single.area}
            onChange={(e) => setSingle({ ...single, area: e.target.value })}
          />
          <Button type="submit" busy={addOne.isPending}>
            Add table
          </Button>
        </form>
      </Card>
      {tables.isLoading ? (
        <Loading />
      ) : !tables.data?.length ? (
        <EmptyState title="No tables yet">Add your tables, then download the QR sheet.</EmptyState>
      ) : (
        <div className="space-y-4">
          {byArea.map(([area, rows]) => (
            <Card key={area} className="p-0">
              <h2 className="border-b border-slate-100 px-4 py-3 font-bold">{area}</h2>
              <div className="divide-y divide-slate-100">
                {rows.map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Table {t.label}</span>
                      <Badge>QR v{t.qrVersion}</Badge>
                      {!t.active && <Badge tone="amber">inactive</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={t.qrUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-brand-700 underline"
                      >
                        Open menu link
                      </a>
                      <a
                        href={apiUrl(`/v1/admin/tables/qr.pdf?ids=${t.id}`)}
                        className="text-sm font-medium text-slate-700 underline"
                      >
                        Print
                      </a>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(t)}>
                        New QR
                      </Button>
                      <Toggle
                        label={`Table ${t.label} active`}
                        checked={t.active}
                        onChange={(active) => toggle.mutate({ id: t.id, active })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          <div className="text-right">
            <Button variant="danger" size="sm" onClick={() => setConfirmRotate('all')}>
              Replace all QR codes…
            </Button>
          </div>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add many tables">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            addBulk.mutate();
          }}
        >
          <div className="grid grid-cols-3 gap-2">
            <Field label="Prefix">
              {(id) => (
                <Input
                  id={id}
                  value={bulk.prefix}
                  onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })}
                />
              )}
            </Field>
            <Field label="From">
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={bulk.from}
                  onChange={(e) => setBulk({ ...bulk, from: e.target.value })}
                />
              )}
            </Field>
            <Field label="To">
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={bulk.to}
                  onChange={(e) => setBulk({ ...bulk, to: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field label="Area (optional)">
            {(id) => (
              <Input
                id={id}
                value={bulk.area}
                onChange={(e) => setBulk({ ...bulk, area: e.target.value })}
              />
            )}
          </Field>
          <p className="text-sm text-slate-600">
            Creates {bulk.prefix}
            {bulk.from} to {bulk.prefix}
            {bulk.to}. Existing labels are skipped.
          </p>
          <ErrorBanner error={addBulk.error ? errorMessage(addBulk.error) : null} />
          <Button type="submit" className="w-full" busy={addBulk.isPending}>
            Create tables
          </Button>
        </form>
      </Modal>

      <Modal
        open={confirmRotate !== null}
        onClose={() => setConfirmRotate(null)}
        title="Replace QR code?"
      >
        <Notice tone="amber">
          {confirmRotate === 'all'
            ? 'Every printed QR code'
            : `The printed QR code for table ${confirmRotate?.label ?? ''}`}{' '}
          will stop working immediately. Print and stick the new code
          {confirmRotate === 'all' ? 's' : ''} afterwards.
        </Notice>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmRotate(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            busy={rotate.isPending}
            onClick={() => confirmRotate && rotate.mutate(confirmRotate)}
          >
            Replace
          </Button>
        </div>
      </Modal>
    </div>
  );
}
