import { Injectable } from '@nestjs/common';
import type { DbClient } from '@app/db';
import {
  canManageRole,
  ErrorCode,
  type DeviceDto,
  type StaffCreateInput,
  type StaffDto,
  type StaffUpdateInput,
} from '@app/shared';
import { AuditService } from '../common/audit.service';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import type { StaffPrincipal } from '../common/request';
import { CredentialsService } from '../auth/credentials.service';

type StaffRow = Awaited<ReturnType<DbClient['staffMember']['findUniqueOrThrow']>>;

function toDto(s: StaffRow): StaffDto {
  return {
    id: s.id,
    name: s.name,
    role: s.role,
    email: s.email,
    active: s.active,
    pinLocked: Boolean(s.pinLockedUntil && s.pinLockedUntil > new Date()),
  };
}

@Injectable()
export class StaffService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly audit: AuditService,
    private readonly credentials: CredentialsService,
  ) {}

  async list(): Promise<StaffDto[]> {
    const rows = await this.db.staffMember.findMany({
      orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(
    actor: StaffPrincipal,
    input: StaffCreateInput,
    ip: string | null,
  ): Promise<StaffDto> {
    if (!canManageRole(actor.role, input.role))
      throw AppError.forbidden('Only owners can add owners');
    if ((input.role === 'OWNER' || input.role === 'MANAGER') && input.email && !input.password) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Set a password so they can sign in with their email',
      );
    }
    const [pinHash, passwordHash] = await Promise.all([
      this.credentials.hashSecret(input.pin),
      input.password ? this.credentials.hashSecret(input.password) : Promise.resolve(null),
    ]);
    const created = await this.db.$transaction(async (tx) => {
      const s = await tx.staffMember.create({
        data: {
          organizationId: actor.organizationId,
          venueId: actor.venueId,
          name: input.name,
          role: input.role,
          email: input.email ?? null,
          passwordHash,
          pinHash,
        },
      });
      await this.audit.record(tx, {
        venueId: actor.venueId,
        actor,
        action: 'STAFF_CREATED',
        entityType: 'StaffMember',
        entityId: s.id,
        after: { name: s.name, role: s.role, email: s.email },
        ip,
      });
      return s;
    });
    return toDto(created);
  }

  async update(
    actor: StaffPrincipal,
    id: string,
    input: StaffUpdateInput,
    ip: string | null,
  ): Promise<StaffDto> {
    const target = await this.db.staffMember.findUnique({ where: { id } });
    if (!target) throw AppError.notFound('Staff member');
    if (!canManageRole(actor.role, target.role))
      throw AppError.forbidden('Only owners can change owners');
    if (target.id === actor.staffId && input.active === false) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'You cannot deactivate yourself');
    }
    if (input.password && !target.email) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Only owners and managers with an email can have a password',
      );
    }
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.active !== undefined) data.active = input.active;
    if (input.pin) {
      data.pinHash = await this.credentials.hashSecret(input.pin);
      data.failedPinAttempts = 0;
      data.pinLockedUntil = null;
    }
    if (input.password) data.passwordHash = await this.credentials.hashSecret(input.password);
    const updated = await this.db.$transaction(async (tx) => {
      const s = await tx.staffMember.update({ where: { id }, data });
      if (input.active === false || input.pin || input.password) {
        // Changing credentials or deactivating signs the person out everywhere.
        await tx.staffSession.updateMany({
          where: { staffId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        venueId: actor.venueId,
        actor,
        action: 'STAFF_UPDATED',
        entityType: 'StaffMember',
        entityId: id,
        before: { name: target.name, active: target.active },
        after: {
          name: s.name,
          active: s.active,
          pinChanged: Boolean(input.pin),
          passwordChanged: Boolean(input.password),
        },
        ip,
      });
      return s;
    });
    return toDto(updated);
  }

  async listDevices(): Promise<DeviceDto[]> {
    const rows = await this.db.device.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
      revoked: Boolean(d.revokedAt),
    }));
  }

  async revokeDevice(id: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.device.update({ where: { id }, data: { revokedAt: new Date() } });
      await tx.staffSession.updateMany({
        where: { deviceId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
