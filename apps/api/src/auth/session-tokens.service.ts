import { Injectable } from '@nestjs/common';
import { tenancy, type DbClient } from '@app/db';
import type { AuthTokensDto } from '@app/shared';
import { InjectDb } from '../common/db';
import { AppError } from '../common/errors';
import { TokenService } from '../common/tokens.service';

export const ADMIN_SESSION_HOURS = 12;
export const CUSTOMER_SESSION_HOURS = 12;

const ended = () => AppError.unauthenticated('Your session has ended. Please sign in again');

/**
 * Issues access/refresh token pairs for staff, platform-admin and customer sessions and
 * rotates refresh tokens. Each refresh token works once: the stored hash is swapped atomically,
 * and presenting a stale token for a live session revokes it (the token was copied).
 */
@Injectable()
export class SessionTokensService {
  constructor(
    @InjectDb() private readonly db: DbClient,
    private readonly tokens: TokenService,
  ) {}

  // ---- Staff ------------------------------------------------------------------------------

  staffPair(sessionId: string, secret: string): AuthTokensDto {
    return this.tokens.pair(
      { typ: 'staff', sid: sessionId },
      this.tokens.refreshToken(sessionId, secret),
    );
  }

  async refreshStaff(refreshToken: string): Promise<AuthTokensDto> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) throw ended();
    return tenancy.runAsSystem(async () => {
      const session = await this.db.staffSession.findUnique({
        where: { id: parsed.sessionId },
        include: { staff: { select: { active: true } }, device: { select: { revokedAt: true } } },
      });
      if (!session || session.revokedAt || session.expiresAt < new Date()) throw ended();
      if (!session.staff.active || session.device?.revokedAt) {
        await this.revokeStaff(session.id);
        throw ended();
      }
      const next = this.tokens.newRefreshSecret();
      const { count } = await this.db.staffSession.updateMany({
        where: { id: session.id, revokedAt: null, refreshTokenHash: parsed.hash },
        data: { refreshTokenHash: next.hash, lastSeenAt: new Date() },
      });
      if (count !== 1) {
        await this.revokeStaff(session.id);
        throw ended();
      }
      return this.staffPair(session.id, next.secret);
    });
  }

  private async revokeStaff(id: string): Promise<void> {
    await this.db.staffSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---- Platform admin ---------------------------------------------------------------------

  async createAdminSession(adminId: string): Promise<AuthTokensDto> {
    const secret = this.tokens.newRefreshSecret();
    const session = await tenancy.runAsSystem(() =>
      this.db.platformAdminSession.create({
        data: {
          adminId,
          refreshTokenHash: secret.hash,
          expiresAt: new Date(Date.now() + ADMIN_SESSION_HOURS * 3600_000),
        },
      }),
    );
    return this.adminPair(adminId, session.id, secret.secret);
  }

  private adminPair(adminId: string, sessionId: string, secret: string): AuthTokensDto {
    return this.tokens.pair(
      { typ: 'admin', aid: adminId, sid: sessionId },
      this.tokens.refreshToken(sessionId, secret),
    );
  }

  async refreshAdmin(refreshToken: string): Promise<AuthTokensDto> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) throw ended();
    return tenancy.runAsSystem(async () => {
      const session = await this.db.platformAdminSession.findUnique({
        where: { id: parsed.sessionId },
      });
      if (!session || session.revokedAt || session.expiresAt < new Date()) throw ended();
      const next = this.tokens.newRefreshSecret();
      const { count } = await this.db.platformAdminSession.updateMany({
        where: { id: session.id, revokedAt: null, refreshTokenHash: parsed.hash },
        data: { refreshTokenHash: next.hash, lastSeenAt: new Date() },
      });
      if (count !== 1) {
        await this.revokeAdmin(session.id);
        throw ended();
      }
      return this.adminPair(session.adminId, session.id, next.secret);
    });
  }

  async revokeAdmin(id: string): Promise<void> {
    await tenancy.runAsSystem(() =>
      this.db.platformAdminSession.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  // ---- Customer ---------------------------------------------------------------------------

  /** (Re)issues tokens for a customer session after joining a table (runs in the venue context). */
  async issueCustomer(c: {
    customerSessionId: string;
    tableSessionId: string;
    venueId: string;
  }): Promise<AuthTokensDto> {
    const secret = this.tokens.newRefreshSecret();
    await this.db.customerSession.update({
      where: { id: c.customerSessionId },
      data: {
        refreshTokenHash: secret.hash,
        expiresAt: new Date(Date.now() + CUSTOMER_SESSION_HOURS * 3600_000),
        revokedAt: null,
      },
    });
    return this.customerPair(c, secret.secret);
  }

  private customerPair(
    c: { customerSessionId: string; tableSessionId: string; venueId: string },
    secret: string,
  ): AuthTokensDto {
    return this.tokens.pair(
      { typ: 'customer', csid: c.customerSessionId, tsid: c.tableSessionId, vid: c.venueId },
      this.tokens.refreshToken(c.customerSessionId, secret),
    );
  }

  async refreshCustomer(refreshToken: string): Promise<AuthTokensDto> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) throw ended();
    return tenancy.runAsSystem(async () => {
      const cs = await this.db.customerSession.findUnique({ where: { id: parsed.sessionId } });
      if (!cs || cs.revokedAt || !cs.expiresAt || cs.expiresAt < new Date()) throw ended();
      const next = this.tokens.newRefreshSecret();
      const { count } = await this.db.customerSession.updateMany({
        where: { id: cs.id, revokedAt: null, refreshTokenHash: parsed.hash },
        data: { refreshTokenHash: next.hash, lastSeenAt: new Date() },
      });
      if (count !== 1) {
        await this.db.customerSession.updateMany({
          where: { id: cs.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        throw ended();
      }
      return this.customerPair(
        { customerSessionId: cs.id, tableSessionId: cs.tableSessionId, venueId: cs.venueId },
        next.secret,
      );
    });
  }
}
