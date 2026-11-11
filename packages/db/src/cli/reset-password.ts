/**
 * Operator tool: sets a new temporary password for an owner/manager (there is no email in the
 * MVP, so no self-service reset). Usage:
 *   pnpm --filter @app/db reset-password owner@venue.ng
 * Prints the temporary password once; share it with the owner over a trusted channel.
 */
import { randomBytes } from 'node:crypto';
import { hash } from 'argon2';
import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: reset-password <email>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const staff = await prisma.staffMember.findUnique({ where: { email } });
    if (!staff) throw new Error(`No staff account with email ${email}`);
    const temporary = randomBytes(9).toString('base64url');
    await prisma.$transaction([
      prisma.staffMember.update({
        where: { id: staff.id },
        data: { passwordHash: await hash(temporary) },
      }),
      prisma.staffSession.updateMany({
        where: { staffId: staff.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    console.info(`Temporary password for ${email}: ${temporary}`);
    console.info('All existing sessions for this account were signed out.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
