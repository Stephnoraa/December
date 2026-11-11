import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AuditAction, formatVenueDateTime, type AuditPageDto } from '@app/shared';
import { get } from '../lib/api';
import { Badge, Button, Card, Loading, PageHeader, Select } from '../components/ui';

const LABELS: Partial<Record<string, string>> = {
  TABLE_OPENED: 'Table opened',
  TABLE_CLOSED: 'Table closed',
  PAYMENT_RECORDED: 'Cash/POS recorded',
  PAYMENT_CONFIRMED: 'Online payment confirmed',
  OVERPAYMENT_FLAGGED: 'Overpayment flagged',
  ITEM_VOIDED: 'Item voided',
  DISCOUNT_APPLIED: 'Discount applied',
  MENU_AVAILABILITY_CHANGED: 'Menu availability',
  SETTINGS_CHANGED: 'Settings changed',
  PAYOUT_CONFIGURED: 'Payout account set',
  STAFF_CREATED: 'Staff added',
  STAFF_UPDATED: 'Staff changed',
  PIN_LOCKOUT: 'PIN locked',
  QR_ROTATED: 'QR codes replaced',
  DEVICE_ENABLED: 'Device enabled',
  VENUE_CREATED: 'Venue created',
  VENUE_SUSPENDED: 'Venue suspended',
  VENUE_ACTIVATED: 'Venue activated',
};

function summary(v: unknown): string {
  if (!v || typeof v !== 'object') return '';
  return Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== null && x !== undefined && typeof x !== 'object')
    .map(([k, x]) => `${k}: ${String(x)}`)
    .join(' · ');
}

export default function Audit() {
  const [action, setAction] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['audit', action],
    queryFn: ({ pageParam }) =>
      get<AuditPageDto>(
        `/v1/admin/audit?limit=50${action ? `&action=${action}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];
  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of money and permission-sensitive actions. Entries can't be edited or deleted."
      />
      <div className="mb-3 max-w-xs">
        <Select
          aria-label="Filter by action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="">All actions</option>
          {Object.values(AuditAction).map((a) => (
            <option key={a} value={a}>
              {LABELS[a] ?? a}
            </option>
          ))}
        </Select>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {events.length === 0 && <p className="p-4 text-sm text-slate-500">No entries.</p>}
          {events.map((e) => (
            <div key={e.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Badge
                    tone={
                      e.action.includes('VOID') ||
                      e.action.includes('OVERPAY') ||
                      e.action.includes('LOCK')
                        ? 'red'
                        : e.action.includes('PAYMENT')
                          ? 'green'
                          : 'slate'
                    }
                  >
                    {LABELS[e.action] ?? e.action}
                  </Badge>
                  <span className="font-semibold">{e.actorName ?? e.actorType.toLowerCase()}</span>
                  {e.approverName && (
                    <span className="text-slate-600">approved by {e.approverName}</span>
                  )}
                </span>
                <span className="text-slate-500">{formatVenueDateTime(e.createdAt)}</span>
              </div>
              {e.reason && <p className="mt-1">Reason: {e.reason}</p>}
              {(summary(e.before) || summary(e.after)) && (
                <p className="mt-1 break-words text-xs text-slate-500">
                  {summary(e.before) && <>Before: {summary(e.before)} · </>}
                  {summary(e.after) && <>After: {summary(e.after)}</>}
                </p>
              )}
            </div>
          ))}
        </Card>
      )}
      {q.hasNextPage && (
        <div className="mt-3 text-center">
          <Button
            variant="secondary"
            busy={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
