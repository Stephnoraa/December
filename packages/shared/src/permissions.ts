import type { StaffRole } from './enums';

export const Permission = {
  VENUE_SETTINGS: 'venue.settings',
  VENUE_PAYOUT: 'venue.payout',
  MENU_MANAGE: 'menu.manage',
  TABLES_MANAGE: 'tables.manage',
  STATIONS_MANAGE: 'stations.manage',
  STAFF_MANAGE: 'staff.manage',
  DEVICES_MANAGE: 'devices.manage',
  FLOOR_OPERATE: 'floor.operate',
  PAYMENTS_RECORD: 'payments.record',
  STATION_OPERATE: 'station.operate',
  ADJUSTMENTS_REQUEST: 'adjustments.request',
  ADJUSTMENTS_APPROVE: 'adjustments.approve',
  DASHBOARD_VIEW: 'dashboard.view',
  AUDIT_VIEW: 'audit.view',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL = Object.values(Permission);

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => p !== Permission.VENUE_PAYOUT),
  WAITER: [Permission.FLOOR_OPERATE, Permission.PAYMENTS_RECORD, Permission.ADJUSTMENTS_REQUEST],
  STATION: [Permission.STATION_OPERATE],
};

export function hasPermission(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Roles whose PIN can approve voids and discounts. */
export function canApproveAdjustments(role: StaffRole): boolean {
  return hasPermission(role, Permission.ADJUSTMENTS_APPROVE);
}

/** Roles that may sign in with email + password (from any phone). */
export function canUsePasswordLogin(role: StaffRole): boolean {
  return role === 'OWNER' || role === 'MANAGER';
}

/** Which roles a staff manager may create or edit. Only owners manage owners. */
export function canManageRole(actor: StaffRole, target: StaffRole): boolean {
  if (!hasPermission(actor, Permission.STAFF_MANAGE)) return false;
  if (target === 'OWNER') return actor === 'OWNER';
  return true;
}

/** Default landing route in the staff app for each role. */
export function homeRouteForRole(role: StaffRole): string {
  switch (role) {
    case 'OWNER':
    case 'MANAGER':
      return '/dashboard';
    case 'WAITER':
      return '/floor';
    case 'STATION':
      return '/station';
  }
}
