import { Injectable } from '@nestjs/common';
import { tenancy, type DbClient } from '@app/db';
import { InjectDb } from '../common/db';
import type { AdminPrincipal, CustomerPrincipal, StaffPrincipal } from '../common/request';
import {
  TokenService,
  type AdminTokenPayload,
  type CustomerTokenPayload,
  type StaffTokenPayload,
} from '../common/tokens.service';

/** Turns cookie tokens into principals. Shared by HTTP guards and the socket gateway. */
@Injectable()
export class SessionResolver {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly tokens: TokenService,
  ) {}

  async staff(token: string | undefined): Promise<StaffPrincipal | null> {
    const payload = this.tokens.verify<StaffTokenPayload>(token, 'staff');
    if (!payload) return null;
    const session = await tenancy.runAsSystem(() =>
      this.db.staffSession.findUnique({
        where: { id: payload.sid },
        include: { staff: true, device: { select: { revokedAt: true } } },
      }),
    );
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    if (!session.staff.active) return null;
    if (session.device?.revokedAt) return null;
    return {
      kind: 'staff',
      staffId: session.staffId,
      venueId: session.venueId,
      organizationId: session.staff.organizationId,
      role: session.staff.role,
      name: session.staff.name,
      sessionId: session.id,
      deviceId: session.deviceId,
    };
  }

  async customer(token: string | undefined): Promise<CustomerPrincipal | null> {
    const payload = this.tokens.verify<CustomerTokenPayload>(token, 'customer');
    if (!payload) return null;
    const cs = await tenancy.runAsSystem(() =>
      this.db.customerSession.findUnique({
        where: { id: payload.csid },
        include: { tableSession: { select: { id: true, tableId: true, venueId: true } } },
      }),
    );
    if (!cs || cs.tableSessionId !== payload.tsid || cs.venueId !== payload.vid) return null;
    return {
      kind: 'customer',
      customerSessionId: cs.id,
      tableSessionId: cs.tableSessionId,
      tableId: cs.tableSession.tableId,
      venueId: cs.venueId,
    };
  }

  async admin(token: string | undefined): Promise<AdminPrincipal | null> {
    const payload = this.tokens.verify<AdminTokenPayload>(token, 'admin');
    if (!payload) return null;
    const admin = await tenancy.runAsSystem(() =>
      this.db.platformAdmin.findUnique({ where: { id: payload.aid } }),
    );
    return admin ? { kind: 'admin', adminId: admin.id, email: admin.email } : null;
  }
}
