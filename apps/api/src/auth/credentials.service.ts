import { HttpStatus, Injectable } from '@nestjs/common';
import { hash, verify } from 'argon2';
import type { DbTx } from '@app/db';
import { ErrorCode } from '@app/shared';
import { AuditService, type Actor } from '../common/audit.service';
import { AppError } from '../common/errors';

export const PIN_MAX_ATTEMPTS = 5;
const BASE_LOCK_MINUTES = 5;
const MAX_LOCK_MINUTES = 60;

/** Lock duration after the n-th lockout (0-based): 5, 10, 20, 40, 60, 60... minutes. */
export function lockMinutes(previousLockouts: number): number {
  return Math.min(MAX_LOCK_MINUTES, BASE_LOCK_MINUTES * 2 ** previousLockouts);
}

// A real hash of a random string, so unknown accounts take as long to reject as real ones.
const DUMMY_HASH = hash('not-a-real-password-' + Math.random().toString(36));

@Injectable()
export class CredentialsService {
  constructor(private readonly audit: AuditService) {}

  hashSecret(secret: string): Promise<string> {
    return hash(secret);
  }

  async verifyPassword(
    passwordHash: string | null | undefined,
    password: string,
  ): Promise<boolean> {
    if (!passwordHash) {
      await verify(await DUMMY_HASH, password).catch(() => false);
      return false;
    }
    return verify(passwordHash, password).catch(() => false);
  }

  /**
   * Checks a staff PIN with attempt limits. After PIN_MAX_ATTEMPTS consecutive failures the
   * PIN is locked for an escalating period and a PIN_LOCKOUT audit event is written.
   *
   * Call with the plain client (in the venue's tenant context), NOT inside a transaction that
   * may roll back: failed attempts must be persisted even though this method then throws.
   */
  async verifyPin(
    tx: DbTx,
    staffId: string,
    pin: string,
    actor: Actor,
    ip: string | null,
  ): Promise<{ id: string; role: string; name: string; venueId: string }> {
    const staff = await tx.staffMember.findUnique({ where: { id: staffId } });
    if (!staff || !staff.active) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Wrong PIN', HttpStatus.UNAUTHORIZED);
    }
    const now = new Date();
    if (staff.pinLockedUntil && staff.pinLockedUntil > now) {
      throw new AppError(
        ErrorCode.PIN_LOCKED,
        'Too many wrong PINs. Try again later or ask a manager.',
        HttpStatus.TOO_MANY_REQUESTS,
        { lockedUntil: staff.pinLockedUntil.toISOString() },
      );
    }
    const ok = await verify(staff.pinHash, pin).catch(() => false);
    if (ok) {
      if (staff.failedPinAttempts > 0 || staff.pinLockedUntil) {
        await tx.staffMember.update({
          where: { id: staff.id },
          data: { failedPinAttempts: 0, pinLockedUntil: null },
        });
      }
      return { id: staff.id, role: staff.role, name: staff.name, venueId: staff.venueId };
    }
    const updated = await tx.staffMember.update({
      where: { id: staff.id },
      data: { failedPinAttempts: { increment: 1 } },
    });
    if (updated.failedPinAttempts >= PIN_MAX_ATTEMPTS) {
      const until = new Date(now.getTime() + lockMinutes(updated.pinLockouts) * 60_000);
      await tx.staffMember.update({
        where: { id: staff.id },
        data: { failedPinAttempts: 0, pinLockedUntil: until, pinLockouts: { increment: 1 } },
      });
      await this.audit.record(tx, {
        venueId: staff.venueId,
        actor,
        action: 'PIN_LOCKOUT',
        entityType: 'StaffMember',
        entityId: staff.id,
        after: { lockedUntil: until.toISOString() },
        ip,
      });
      throw new AppError(
        ErrorCode.PIN_LOCKED,
        'Too many wrong PINs. Try again later or ask a manager.',
        HttpStatus.TOO_MANY_REQUESTS,
        { lockedUntil: until.toISOString() },
      );
    }
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Wrong PIN', HttpStatus.UNAUTHORIZED, {
      attemptsLeft: PIN_MAX_ATTEMPTS - updated.failedPinAttempts,
    });
  }
}
