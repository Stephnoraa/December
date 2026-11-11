import { Injectable } from '@nestjs/common';
import type { DbTx, Prisma } from '@app/db';
import type { ActorType, AuditAction } from '@app/shared';
import type { AdminPrincipal, CustomerPrincipal, StaffPrincipal } from './request';

export type Actor = StaffPrincipal | CustomerPrincipal | AdminPrincipal | { kind: 'system' };

export interface AuditInput {
  venueId: string;
  actor: Actor;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  reason?: string | null;
  approverId?: string | null;
  ip?: string | null;
}

function actorFields(actor: Actor): {
  actorType: ActorType;
  actorId: string | null;
  deviceId: string | null;
} {
  switch (actor.kind) {
    case 'staff':
      return { actorType: 'STAFF', actorId: actor.staffId, deviceId: actor.deviceId };
    case 'customer':
      return { actorType: 'CUSTOMER', actorId: actor.customerSessionId, deviceId: null };
    case 'admin':
      return { actorType: 'PLATFORM_ADMIN', actorId: actor.adminId, deviceId: null };
    case 'system':
      return { actorType: 'SYSTEM', actorId: null, deviceId: null };
  }
}

/** Writes append-only audit events. Always call with the transaction that makes the change. */
@Injectable()
export class AuditService {
  async record(tx: DbTx, input: AuditInput): Promise<void> {
    await tx.auditEvent.create({
      data: {
        venueId: input.venueId,
        ...actorFields(input.actor),
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        reason: input.reason ?? null,
        approverId: input.approverId ?? null,
        ip: input.ip ?? null,
      },
    });
  }
}
