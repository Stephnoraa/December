/**
 * Operator tool: creates (or resets) a platform super-admin. There is no self-signup.
 *   ADMIN_PASSWORD='…' pnpm --filter @app/db create-admin you@example.ng "Your Name"
 */
import { hash } from 'argon2';
import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const name = process.argv[3]?.trim() || 'Platform Admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    console.error('Usage: ADMIN_PASSWORD=<at least 12 chars> create-admin <email> [name]');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const passwordHash = await hash(password);
    await prisma.platformAdmin.upsert({
      where: { email },
      update: { passwordHash, name },
      create: { email, name, passwordHash },
    });
    console.info(`Platform admin ${email} is ready.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
