# CLAUDE.md — QR table ordering MVP

Source of truth for scope: `MVP_BUILD_PROMPT.md`. Status, decisions and follow-ups: `PROGRESS.md`.
When resuming, read both and continue from the first milestone not marked done.

## Scope

- Build only Section 2 of the brief. Never build Section 3 ("Out of scope"): no printers, offline
  mode, split-bill tools, modifier rules, extra levies, email/WhatsApp receipts, tips, 2FA, etc.
- Business choices are made autonomously and logged under "Decisions" in PROGRESS.md.

## Stack

TypeScript strict · pnpm workspaces + Turborepo · NestJS 11 (Express 5) · Prisma 6 + Postgres ·
Socket.IO (+ Redis adapter) · @nestjs/schedule · zod 4 · React 19 + Vite 7 + TanStack Query 5 +
React Router 7 + Tailwind 4 PWAs · sharp · pdfkit · Paystack · Vitest 3 · Playwright.
Pinned to established majors on purpose (TS 7 / Prisma 8 / Nest 12 deferred).

## Layout

```
apps/api          NestJS API + Socket.IO (src/<feature>/, common/, auth/, config/env.ts)
apps/customer     Customer PWA (port 5173)
apps/staff        Staff PWA: waiter, station, manager, owner dashboard, platform admin (port 5174)
packages/db       Prisma schema, migrations, tenancy extension, seed, test DB helpers
packages/shared   zod schemas, enums, events, money + tab calculation, state machines, permissions
e2e               Playwright critical-path test
infra             Dockerfile, docker-compose.yml, Cloud Run / Pages config
docs              RUNBOOK.md, ARCHITECTURE.md, PAYSTACK_TEST_CHECKLIST.md, PILOT_CHECKLIST.md
```

## Commands

```
pnpm install
pnpm services:up                # docker: postgres, redis, minio   (or: pnpm services:native start)
cp .env.example .env            # native services: set STORAGE_DRIVER=local
pnpm build                      # builds packages (shared, db) — required before typecheck/test
pnpm db:deploy && pnpm db:seed  # or pnpm db:migrate for new migrations
pnpm dev                        # api :3000, customer :5173, staff :5174
pnpm lint | pnpm typecheck | pnpm test | pnpm test:e2e
```

Tests without Docker: `TEST_DATABASE_URL=postgresql://qr:qr@127.0.0.1:5432/postgres TEST_REDIS_URL=redis://127.0.0.1:6379/15 pnpm test`.
New migration: edit `packages/db/prisma/schema.prisma`, then `pnpm db:migrate --name <name>`
(or `prisma migrate diff` into a new folder). Never edit applied migrations.

## Money rules

- Integers in kobo only (`*Kobo` columns, `number` safe integers). Rates in basis points (`*Bps`).
- All arithmetic via `packages/shared/src/money.ts` (half-up rounding, BigInt for division).
  Display with `formatNaira()` (en-NG). Parse user input with `parseNairaToKobo()`.
- Order items snapshot name, base price, add-ons and unit price at order time.
- Tab totals only from `calculateTab()` (subtotal → discounts → service charge → VAT → total).
  Tab rows cache the result plus `version`; recompute through `TabsService.recalculate(tx, tabId)`.
- A payment counts only when SUCCESS (Paystack verified server-side, or staff-recorded cash/POS).

## Tenancy rules

- Every tenant-owned row has `venueId`. Use the injected `DB` client (tenancy extension).
- HTTP requests start with an empty context; `StaffAuth`/`CustomerAuth` guards bind the venue.
  Public routes bind it after resolving the table token. Background work uses
  `tenancy.runForVenue()` or `tenancy.runAsSystem()` explicitly (system = cross-venue, rare).
- Don't use nested writes to create tenant rows without `venueId`; raw SQL must filter `"venueId"`.
- Row locks: `lockRow(tx, 'Tab', id, venueId)` inside `db.$transaction`.

## API conventions

- REST under `/v1`: `/v1/auth`, `/v1/public/*` (customer), `/v1/staff/*`, `/v1/admin/*`
  (manager/owner), `/v1/platform/*` (super-admin), `/v1/webhooks/paystack`.
- Validate every body/query with shared zod schemas (`ZBody(schema)`).
- Errors: throw `AppError(code, message, status)`; shape `{ error: { code, message, details? } }`.
- Mutations accept `Idempotency-Key` (global interceptor). Clients always send one.
- Audit money/permission-sensitive changes with `AuditService.record(tx, …)` in the same tx.
- Emit socket events only after commit (`EventsService.emit`); events carry ids + `version`.
- Cookies: `qr_staff`, `qr_device`, `qr_customer`, `qr_admin` — HttpOnly, SameSite=Lax, signed JWT.
- Don't use `import type` for Nest-injected classes in apps/api (DI needs runtime metadata).

## Testing rules

- Unit tests next to pure logic (`packages/shared/test`). Integration tests in `apps/api/test`
  and `packages/db/test` run the real app against a fresh database cloned from a migrated
  template (Testcontainers, or TEST_DATABASE_URL/TEST_REDIS_URL).
- Paystack is mocked through the `PaymentProvider` interface in tests.
- A milestone is done only when `pnpm lint`, `pnpm typecheck` and `pnpm test` pass. Never skip,
  disable or weaken tests. No `any` without a justifying comment.
