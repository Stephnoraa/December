import { NavLink, Outlet } from 'react-router';
import { Permission } from '@app/shared';
import { useSession } from '../lib/session';
import { useLiveConnection } from '../lib/socket';
import { cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  permission: Permission;
}

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', permission: Permission.DASHBOARD_VIEW },
  { to: '/floor', label: 'Floor', permission: Permission.FLOOR_OPERATE },
  { to: '/station', label: 'Station', permission: Permission.STATION_OPERATE },
  { to: '/setup/menu', label: 'Menu', permission: Permission.MENU_MANAGE },
  { to: '/setup/tables', label: 'Tables', permission: Permission.TABLES_MANAGE },
  { to: '/setup/stations', label: 'Stations', permission: Permission.STATIONS_MANAGE },
  { to: '/setup/staff', label: 'Staff', permission: Permission.STAFF_MANAGE },
  { to: '/audit', label: 'Audit log', permission: Permission.AUDIT_VIEW },
  { to: '/settings', label: 'Settings', permission: Permission.VENUE_SETTINGS },
];

export function ConnectionDot() {
  const state = useLiveConnection();
  const label =
    state === 'online' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Reconnecting';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300"
      title={`Realtime: ${label}`}
    >
      <span
        className={cx(
          'h-2 w-2 rounded-full',
          state === 'online' ? 'bg-emerald-400' : 'animate-pulse bg-amber-400',
        )}
      />
      {label}
    </span>
  );
}

export function Layout() {
  const { me, can, logout } = useSession();
  const items = NAV.filter((n) => can(n.permission));
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {me.venue.logoUrl && (
              <img
                src={me.venue.logoUrl}
                alt=""
                className="h-8 w-8 rounded-lg bg-white object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="truncate font-bold">{me.venue.name}</p>
              <p className="truncate text-xs text-slate-400">
                {me.staff.name} · {me.staff.role.toLowerCase()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionDot />
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold hover:bg-slate-700"
            >
              {me.deviceId ? 'Switch user' : 'Sign out'}
            </button>
          </div>
        </div>
        {me.venue.status === 'SUSPENDED' && (
          <div className="bg-red-600 px-4 py-2 text-center text-sm font-semibold">
            This venue is suspended: customers cannot order. Contact support.
          </div>
        )}
        {items.length > 1 && (
          <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 pb-2" aria-label="Main">
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cx(
                    'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium',
                    isActive ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-slate-800',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
