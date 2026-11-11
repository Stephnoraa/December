import type { Request } from 'express';
import type { StaffRole } from '@app/shared';

export interface StaffPrincipal {
  kind: 'staff';
  staffId: string;
  venueId: string;
  organizationId: string;
  role: StaffRole;
  name: string;
  sessionId: string;
  deviceId: string | null;
}

export interface CustomerPrincipal {
  kind: 'customer';
  customerSessionId: string;
  tableSessionId: string;
  tableId: string;
  venueId: string;
}

export interface AdminPrincipal {
  kind: 'admin';
  adminId: string;
  email: string;
}

export interface AppRequest extends Request {
  staff?: StaffPrincipal;
  customer?: CustomerPrincipal;
  admin?: AdminPrincipal;
  rawBody?: Buffer;
}

export function clientIp(req: Request): string | null {
  return req.ip ?? null;
}
