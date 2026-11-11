import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { ChecklistDto } from '@app/shared';
import { get } from '../lib/api';
import { Badge, Card } from '../components/ui';

export function useChecklist() {
  return useQuery({
    queryKey: ['checklist'],
    queryFn: () => get<ChecklistDto>('/v1/admin/venue/checklist'),
  });
}

export function SetupChecklist({ checklist }: { checklist: ChecklistDto }) {
  const done = checklist.items.filter((i) => i.done).length;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Get ready to go live</h2>
          <p className="text-sm text-slate-600">
            {done} of {checklist.items.length} done.{' '}
            {checklist.ready
              ? 'Required steps are complete: you can take orders.'
              : 'Finish the required steps to start taking orders.'}
          </p>
        </div>
        {checklist.ready ? <Badge tone="green">Ready</Badge> : <Badge tone="amber">Setup</Badge>}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-brand-600"
          style={{ width: `${(done / checklist.items.length) * 100}%` }}
        />
      </div>
      <ol className="mt-4 divide-y divide-slate-100">
        {checklist.items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3 py-3">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${item.done ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'}`}
              >
                {item.done ? '✓' : ''}
              </span>
              <div>
                <p className="font-semibold">
                  {item.label}{' '}
                  {!item.required && (
                    <span className="text-xs font-normal text-slate-500">(optional)</span>
                  )}
                </p>
                <p className="text-sm text-slate-600">{item.description}</p>
              </div>
            </div>
            <Link
              to={item.href}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-700 ring-1 ring-brand-600/30 hover:bg-brand-50"
            >
              {item.done ? 'Edit' : 'Set up'}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
