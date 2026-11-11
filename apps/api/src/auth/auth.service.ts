import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, tenancy, type DbClient } from '@app/db';
import {
  canUsePasswordLogin,
  ErrorCode,
  ROLE_PERMISSIONS,
  type LoginInput,
  type PinLoginInput,
  type SignupInput,
  type StaffRole,
} from '@app/shared';
import { AuditService } from '../common/audit.service';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import type { StaffPrincipal } from '../common/request';
import { StorageService } from '../storage/storage.service';
import { CredentialsService } from './credentials.service';

export const PASSWORD_SESSION_HOURS = 24 * 7;
export const PIN_SESSION_HOURS = 12;
export const DEVICE_COOKIE_DAYS = 365;

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'venue';
}

export interface MeResponse {
  staff: { id: string; name: string; role: StaffRole };
  venue: {
    id: string;
    name: string;
    slug: string;
    status: string;
    paymentMode: string;
    logoUrl: string | null;
  };
  permissions: string[];
  deviceId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly credentials: CredentialsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      const taken = await this.db.venue.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }

  /** Owner self-signup: creates the organization, the venue and the owner account. */
  async signup(
    input: SignupInput,
    ip: string | null,
  ): Promise<{ sessionId: string; expiresAt: Date }> {
    return tenancy.runAsSystem(async () => {
      const existing = await this.db.staffMember.findUnique({ where: { email: input.email } });
      if (existing)
        throw AppError.conflict(ErrorCode.EMAIL_TAKEN, 'An account with this email already exists');
      const [passwordHash, pinHash, slug] = await Promise.all([
        this.credentials.hashSecret(input.password),
        this.credentials.hashSecret(input.pin),
        this.uniqueSlug(input.venueName),
      ]);
      try {
        return await this.db.$transaction(async (tx) => {
          const org = await tx.organization.create({ data: { name: input.venueName } });
          const venue = await tx.venue.create({
            data: { organizationId: org.id, name: input.venueName, slug },
          });
          const owner = await tx.staffMember.create({
            data: {
              organizationId: org.id,
              venueId: venue.id,
              name: input.ownerName,
              role: 'OWNER',
              email: input.email,
              passwordHash,
              pinHash,
            },
          });
          await this.audit.record(tx, {
            venueId: venue.id,
            actor: { kind: 'system' },
            action: 'VENUE_CREATED',
            entityType: 'Venue',
            entityId: venue.id,
            after: { name: venue.name, slug, ownerId: owner.id },
            ip,
          });
          const expiresAt = new Date(Date.now() + PASSWORD_SESSION_HOURS * 3600_000);
          const session = await tx.staffSession.create({
            data: { venueId: venue.id, staffId: owner.id, method: 'PASSWORD', expiresAt },
          });
          return { sessionId: session.id, expiresAt };
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw AppError.conflict(
            ErrorCode.EMAIL_TAKEN,
            'An account with this email already exists',
          );
        }
        throw err;
      }
    });
  }

  async passwordLogin(input: LoginInput): Promise<{ sessionId: string; expiresAt: Date }> {
    return tenancy.runAsSystem(async () => {
      const staff = await this.db.staffMember.findUnique({ where: { email: input.email } });
      const valid = await this.credentials.verifyPassword(staff?.passwordHash, input.password);
      if (!staff || !valid || !staff.active || !canUsePasswordLogin(staff.role)) {
        throw new AppError(
          ErrorCode.INVALID_CREDENTIALS,
          'Wrong email or password',
          HttpStatus.UNAUTHORIZED,
        );
      }
      const expiresAt = new Date(Date.now() + PASSWORD_SESSION_HOURS * 3600_000);
      const session = await this.db.staffSession.create({
        data: { venueId: staff.venueId, staffId: staff.id, method: 'PASSWORD', expiresAt },
      });
      return { sessionId: session.id, expiresAt };
    });
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.staffSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(principal: StaffPrincipal): Promise<MeResponse> {
    const venue = await this.db.venue.findUniqueOrThrow({ where: { id: principal.venueId } });
    return {
      staff: { id: principal.staffId, name: principal.name, role: principal.role },
      venue: {
        id: venue.id,
        name: venue.name,
        slug: venue.slug,
        status: venue.status,
        paymentMode: venue.paymentMode,
        logoUrl: this.storage.publicUrl(venue.logoKey),
      },
      permissions: [...ROLE_PERMISSIONS[principal.role]],
      deviceId: principal.deviceId,
    };
  }

  /** A manager enables PIN login on the device they are using. Returns the raw device token. */
  async enableDevice(
    principal: StaffPrincipal,
    name: string,
    ip: string | null,
  ): Promise<{ token: string; deviceId: string }> {
    const token = randomBytes(32).toString('base64url');
    const device = await this.db.$transaction(async (tx) => {
      const d = await tx.device.create({
        data: {
          venueId: principal.venueId,
          name,
          tokenHash: hashDeviceToken(token),
          enabledByStaffId: principal.staffId,
        },
      });
      await this.audit.record(tx, {
        venueId: principal.venueId,
        actor: principal,
        action: 'DEVICE_ENABLED',
        entityType: 'Device',
        entityId: d.id,
        after: { name },
        ip,
      });
      return d;
    });
    return { token, deviceId: device.id };
  }

  async resolveDevice(token: string | undefined) {
    if (!token) return null;
    const device = await tenancy.runAsSystem(() =>
      this.db.device.findUnique({
        where: { tokenHash: hashDeviceToken(token) },
        include: { venue: true },
      }),
    );
    if (!device || device.revokedAt) return null;
    return device;
  }

  /** Venue + active staff list shown on a PIN-login device. */
  async deviceInfo(token: string | undefined) {
    const device = await this.resolveDevice(token);
    if (!device)
      throw new AppError(
        ErrorCode.DEVICE_NOT_REGISTERED,
        'This device is not set up for PIN login',
        401,
      );
    return tenancy.runForVenue(device.venueId, async () => {
      const staff = await this.db.staffMember.findMany({
        where: { active: true },
        select: { id: true, name: true, role: true },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      });
      await this.db.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      return {
        device: { id: device.id, name: device.name },
        venue: {
          id: device.venue.id,
          name: device.venue.name,
          logoUrl: this.storage.publicUrl(device.venue.logoKey),
          status: device.venue.status,
        },
        staff,
      };
    });
  }

  async pinLogin(
    deviceToken: string | undefined,
    input: PinLoginInput,
    ip: string | null,
  ): Promise<{ sessionId: string; expiresAt: Date }> {
    const device = await this.resolveDevice(deviceToken);
    if (!device)
      throw new AppError(
        ErrorCode.DEVICE_NOT_REGISTERED,
        'This device is not set up for PIN login',
        401,
      );
    return tenancy.runForVenue(device.venueId, async () => {
      // Staff of another venue are invisible here, so their id simply fails as a wrong PIN.
      const staff = await this.credentials.verifyPin(
        this.db,
        input.staffId,
        input.pin,
        { kind: 'system' },
        ip,
      );
      const expiresAt = new Date(Date.now() + PIN_SESSION_HOURS * 3600_000);
      const session = await this.db.staffSession.create({
        data: {
          venueId: device.venueId,
          staffId: staff.id,
          method: 'PIN',
          deviceId: device.id,
          expiresAt,
        },
      });
      return { sessionId: session.id, expiresAt };
    });
  }

  async platformLogin(input: LoginInput): Promise<{ adminId: string }> {
    return tenancy.runAsSystem(async () => {
      const admin = await this.db.platformAdmin.findUnique({ where: { email: input.email } });
      const valid = await this.credentials.verifyPassword(admin?.passwordHash, input.password);
      if (!admin || !valid) {
        throw new AppError(
          ErrorCode.INVALID_CREDENTIALS,
          'Wrong email or password',
          HttpStatus.UNAUTHORIZED,
        );
      }
      return { adminId: admin.id };
    });
  }
}
