# PROGRESS

Spec: `MVP_BUILD_PROMPT.md` (MVP, milestones M0–M6). Conventions: `CLAUDE.md`.
Built autonomously per the owner's instructions: no approval stops, decisions logged below.

## Milestone status

| Milestone           | Status      | Notes                                                                              |
| ------------------- | ----------- | ---------------------------------------------------------------------------------- |
| M0 – Scaffold       | in progress | monorepo, tooling, compose, CI, health, env validation, docs                       |
| M1 – Data & auth    | in progress | schema, migrations + audit triggers, tenancy, idempotency, seed, auth, super-admin |
| M2 – Venue setup    | not started |                                                                                    |
| M3 – Ordering loop  | not started |                                                                                    |
| M4 – Payments       | not started |                                                                                    |
| M5 – Owner controls | not started |                                                                                    |
| M6 – Ship           | not started |                                                                                    |

## Implementation plan

**M0 – Scaffold.** pnpm + Turborepo; root ESLint (flat) + Prettier; strict TS base config;
`infra/docker-compose.yml` (Postgres 17, Redis 7, MinIO + bucket init); `scripts/native-services.sh`
for machines without Docker; NestJS API with `/healthz` + `/readyz`; zod env validation;
GitHub Actions CI (build, lint, typecheck, format, unit + Testcontainers integration tests,
bundle budget, Playwright).

**M1 – Data & auth.** Prisma schema (Section 5 + StaffSession, Device, PlatformAdmin);
migrations incl. append-only triggers on AuditEvent, one-live-session-per-table partial index,
money CHECK constraints. Tenancy: AsyncLocalStorage context + Prisma query extension, tests
proving cross-venue reads/writes fail. Idempotency interceptor + store. Seed (Demo Lounge).
Auth: owner signup/login (argon2), device enablement + staff PIN login with lockout, role
permissions + guards, seeded super-admin login.

**M2 – Venue setup.** Settings (name, logo, payment mode, VAT, service charge, inclusive),
Paystack payout onboarding (list banks, resolve account, create sub-account), stations, tables,
signed QR tokens + rotation + printable PDF, menu categories/items/add-ons, photo upload
(pre-signed → sharp WebP), availability toggles, staff management, setup checklist UI.

**M3 – Ordering loop.** Socket.IO gateway (+ Redis adapter), rooms (venue, owner, station,
table-session, table, venue-menu), typed events. Table sessions (waiter opens/closes), customer
join via signed cookie, ordering (snapshots, add-ons, notes), live item status, live tab,
call-waiter / request-bill. Customer PWA, station screen, waiter floor view.

**M4 – Payments.** Tab calculation wiring, PaymentProvider interface (Paystack + mock),
checkout initialise, webhook (HMAC-SHA512 over raw body) + verify, idempotent processing,
reservations + row locks for concurrent partial payments, overpayment flagging,
reconciliation job, PREPAY release on payment + expiry, cash/POS recording, on-screen receipt.

**M5 – Owner controls.** Voids/discounts with manager PIN + reason, audit log view, live owner
dashboard (sales today, open tabs, payments by method, voids/discounts with approver),
platform admin screen (venues, setup status, suspend/activate).

**M6 – Ship.** Playwright critical-path test, API Dockerfile, Cloud Run + Cloudflare Pages
config, GitHub Actions deploy (staging on main, production on tag), RUNBOOK, Paystack test
checklist, pilot checklist (venue live in under an hour).

## Decisions

Format: decision — reason.

- Pinned TypeScript 5.9, Prisma 6.19, NestJS 11, Vite 7, Vitest 3, React Router 7, ESLint 9 instead of the newest majors (TS 7, Prisma 8 rc, Nest 12, Vite 8) — boring, well-supported, ecosystem-compatible for a December pilot.
- Node 22 LTS — available locally and on Cloud Run base images.
- Vitest everywhere (SWC plugin for Nest decorator metadata) — one test runner.
- No Docker on the build machine: integration tests use `TEST_DATABASE_URL`/`TEST_REDIS_URL` when set, Testcontainers otherwise (CI) — same tests, two ways to get services.
- `STORAGE_DRIVER=local` fallback (disk + signed upload route) besides S3/MinIO/R2 — lets the app run without MinIO; refused in production.
- Each test file gets a fresh database cloned from a migrated template — audit triggers forbid DELETE/TRUNCATE, so tests never clean up by deleting.
- Tenancy throws on queries with no context and requires explicit `runAsSystem` for cross-venue work — fail closed.
- Venue model scoped by AND-ing `id` (not overwriting) — a lookup for another venue's id returns nothing.
- Postgres RLS not added — not required by the MVP brief; the Prisma extension + tests are the enforcement. Revisit with multi-branch.
- Owner/manager emails are globally unique and each staff member belongs to one venue — the UI handles one venue per organization; a membership table can come later.
- PIN login only on devices a manager has enabled (device cookie, token stored hashed); staff pick their name then enter a PIN — no unique-PIN requirement, no remote brute force.
- PIN lockout: 5 consecutive wrong PINs → lock 5 min, doubling per lockout up to 60 min, audited — standard, low friction.
- PIN checks run outside the caller's transaction — failed attempts must persist when the request errors.
- Sessions stored server-side (StaffSession) behind a signed JWT cookie: password sessions 7 days, PIN sessions 12 hours (a shift) — revocable; 2FA can later add a step-up flag to the session.
- No email sending in the MVP (receipts are out of scope) — so no email verification or reset email; owners' passwords are reset by the operator via a CLI (see follow-ups).
- New self-signup venues start ACTIVE; the operator can suspend — onboarding in under an hour without waiting for approval.
- Default `pricesIncludeVat = true` — menu price is what the guest pays; venues can switch to exclusive.
- VAT applies on top of the service charge (subtotal → discounts → service charge → VAT, as the brief orders it); with inclusive prices, service charge is computed on the net-of-VAT amount.
- Charge settings (VAT %, service %, inclusive) are snapshotted on the tab when the table opens — changing settings mid-service doesn't alter open tabs.
- Business day for "today" on the dashboard starts 06:00 Africa/Lagos — late-night sales count towards the evening's trading.

## Blocked / follow-up

- (none yet)

## What I need from you (before deploying)

To be completed in M6.
