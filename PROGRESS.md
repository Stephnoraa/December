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

## Final verification (2026-11-11)

- `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`: pass.
- `pnpm test`: 146 tests pass (shared 38, db 32, api 75, customer 1) against native Postgres 17 + Redis 8.
- `pnpm test:e2e`: critical path + anti-prank pass (3 consecutive green runs) on the built stack.
- Whole stack started with the dev servers against a freshly migrated + seeded database; the
  critical-path test passes against it (remote mode, exercising cross-origin API calls).
- Customer initial JS: 117 KB gzipped (budget 200 KB).

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
- Rate limits per IP: 300/min overall, 10/min sign-in + PIN login, 120/min public customer routes; counters in Redis (namespaced by `REDIS_KEY_PREFIX`) so they hold across Cloud Run instances.
- Idempotency records are scoped to the caller (staff session, customer session, admin, or IP for anonymous) + method + route, kept 24h; failed requests release the key.
- Operator password reset via `pnpm --filter @app/db reset-password <email>` (prints a temporary password, signs out sessions) — no email in the MVP.
- Local-storage media served at `/media/*` by the API (Vite owns `/assets/*` for build output).
- Menu photos are re-encoded to 640px WebP (q72, ~20–40 KB), logos to 256px; originals deleted after processing.
- Menu items and add-ons are archived, never deleted (order items keep pointing at them).
- Checklist: stations, menu, tables, a waiter + a station login, an enabled device are required; payout account is required only for PREPAY venues (POSTPAY venues can take cash/POS without it).
- Brand-neutral product name "QR Ordering" in the PWAs — the customer app shows the venue's own name and logo.
- Realtime events carry ids + versions only; clients refetch over REST and drop TAB_UPDATED events older than their cached tab version. Events are emitted after commit (no outbox table in the MVP — a lost event is healed by the refetch on reconnect and a 60s background refetch).
- Read-only scanners join a public `table:{id}` room after proving they hold a valid QR token, so ordering unlocks live when the waiter opens the table.
- Once a table is open, anyone holding its current QR link can join that tab (as the brief specifies). Mitigations: waiter-opened sessions only, QR rotation per table, rate limits. A per-table join code is a possible later hardening.
- "Call waiter" works on unopened tables (that's how a customer asks for the table to be opened); repeated taps within 2 minutes reuse the open request.
- Order numbers are per tab (#1, #2…); the tab row is locked while numbering and recalculating.
- Item status changes are conditional updates on the current status — two staff tapping at once can't both win.
- "Unavailable" switches the menu item off venue-wide by default (station can opt out); the one-tap undo restores both the order item (back to Sent) and menu availability, within a 10-minute window shown on the station screen.
- Station queue shows SENT and ACCEPTED items for PLACED orders; READY items move to the waiter's "Ready to serve" list.
- Customer PWA imports a zod-free shared entry (`packages/shared/src/client.ts`) to stay small; CI enforces the 200 KB gzipped budget (`pnpm --filter @app/customer check:bundle`).
- Cart is stored per table session in localStorage (survives reload/rescan); order submission reuses its Idempotency-Key on network retries.
- Paystack endpoints and fields were checked against Paystack's official OpenAPI spec (github.com/PaystackOSS/openapi, dist/paystack.yaml) because paystack.com/docs blocks automated fetches; the webhook scheme (x-paystack-signature = hex HMAC-SHA512 of the raw body with the secret key) was confirmed from Paystack's docs pages via search. Doc URLs are cited in `apps/api/src/payments/paystack.provider.ts`.
- A payment counts only after `GET /transaction/verify/:reference` says `success` in NGN — the webhook (signature-checked) and the customer's return from checkout both just trigger that verification. A signed webhook whose transaction Paystack doesn't confirm changes nothing.
- Checkout channels: card, bank_transfer, ussd (as the brief lists).
- Paystack fees are borne by the venue sub-account (`bearer: subaccount`), platform commission 0% (`PAYSTACK_SUBACCOUNT_PERCENTAGE=0`) — the operator bills subscriptions outside the app; both are env-configurable.
- Concurrent partial payments: the tab row is locked while a payment is started; a pending online payment reserves its amount for `PAYMENT_RESERVATION_MINUTES` (15). "Pay full balance" pays balance − others' reservations; a customer starting again releases their own earlier reservation; backing out of checkout releases it immediately.
- If late confirmations still exceed the balance (e.g. an expired reservation is paid), the money is recorded, the excess is flagged on the payment (`overpaidKobo`) and the tab (`overpaidKobo`), an OVERPAYMENT_FLAGGED audit event is written and the dashboard lists it as a refund due. Refunds are done by the venue/operator in the Paystack dashboard (no refund API in the MVP).
- PREPAY: each order is paid on its own (amount = what releasing it adds to the tab total, so balances end at exactly zero); orders unpaid after 30 minutes are cancelled. If a paid PREPAY item turns out unavailable, the tab shows an overpaid credit (refund due). Staff can also settle a held order with cash/POS, which releases it.
- Cash/POS amounts above the balance are refused ("record the balance, give change").
- Webhook events are stored raw before processing (deduped by body hash); invalid signatures get 401 and are kept for audit; events for unknown references are acknowledged (other integrations on the same Paystack account); processing errors return non-2xx so Paystack retries.
- Reconciliation runs every minute in-process (`@nestjs/schedule`) for pending payments older than 3 minutes; checkouts unconfirmed after 60 minutes become FAILED (a later Paystack success would still be recorded). A Redis lock makes one instance do the work.
- Payout onboarding resolves the account name with Paystack before creating the sub-account; changing the account creates a new sub-account (old one left in Paystack).
- Local/dev payments use a mock provider with a `/mock-pay/:reference` checkout page that delivers a correctly signed webhook; it is disabled in production by env validation.
- Voids/discounts: the approver (manager/owner) picks their name and enters their PIN on the requesting device; a manager may approve their own request (both ids recorded). Wrong approver PINs count towards that approver's lockout. Discounts can be % or ₦, on one item or the whole bill; voids remove a billable item. They are allowed only while the table is open.
- Dashboard "sales today" = payments collected (verified) since 06:00 Lagos, split by card/transfer/USSD/cash/POS; "refunds due" lists tabs with an overpaid credit from the last 7 days.
- Suspending a venue blocks the customer pages (polite "ordering unavailable" message) and new orders/table openings; staff can still sign in and settle open tabs.
- API image: multi-stage, non-root (`node` user, tini), `pnpm deploy --prod` output with the Prisma client generated in place; the same image runs migrations via the `qr-prisma` wrapper bin (uses `DIRECT_DATABASE_URL`).
- Cloud Run: min instances 1, 60-minute request timeout (WebSocket max), session affinity, CPU always allocated (instance-based billing) so the in-process scheduler runs, startup CPU boost, `/healthz` probes. Secrets from Secret Manager, one per variable per environment.
- Frontends on Cloudflare Pages with SPA fallback (no 404.html) and `_headers` for caching/security; `VITE_API_URL` injected at build time. Same parent domain for API and apps so cookies stay first-party (SameSite=Lax).
- The mock payment provider is refused when `APP_ENV=production`; with `NODE_ENV=production` it needs `APP_ENV=staging` + `ALLOW_MOCK_PAYMENTS=true` (dedicated e2e staging service only).
- Business day for "today" on the dashboard starts 06:00 Africa/Lagos — late-night sales count towards the evening's trading.

## Blocked / follow-up

- **No Docker on the build machine.** `infra/docker-compose.yml`, `infra/Dockerfile` and the Testcontainers path were written but not executed here. Verified instead: the same tests against native Postgres 17 + Redis 8, and the Dockerfile's `pnpm deploy --prod` + `qr-prisma generate` + boot sequence run outside Docker with production-like env. First CI run will exercise Docker/Testcontainers.
- **No cloud deploys were attempted** (as instructed). The deploy workflow, `infra/cloudrun/*` and Pages steps are untested until the accounts below exist.
- **Critical-path e2e against staging** needs a dedicated staging API with `ALLOW_MOCK_PAYMENTS=true` (Paystack's hosted checkout can't be automated); real Paystack test mode is covered by the manual `docs/PAYSTACK_TEST_CHECKLIST.md`. See RUNBOOK §11.
- **paystack.com/docs blocks automated fetching**: endpoints/fields were verified against Paystack's official OpenAPI spec and docs snippets. Before go-live, confirm in the Paystack dashboard whether a separate _webhook signing secret_ is enabled on your account; if so, set it as `PAYSTACK_WEBHOOK_SECRET` (both keys are accepted).
- **Refunds** are flagged (dashboard "Refunds due", audit) but executed manually in the Paystack dashboard or in cash — no refund API in the MVP.
- **Changing a payout account** creates a new Paystack sub-account; the old one stays in Paystack (harmless). Updating via `PUT /subaccount/:code` is a possible refinement.
- **Open-table joining**: anyone holding a table's current QR link can join an _open_ table's tab (per the brief). If remote pranks on open tables happen, add a per-session join code or staff confirmation of each new device.
- **Postgres RLS** not enabled (defence in depth). Production should run the app with a DB role that doesn't own the tables (so the audit triggers can't be disabled by the app role).
- **Email**: none in the MVP, so no password-reset email; operators use `pnpm --filter @app/db reset-password <email>`.
- Real-device check on a mid-range Android phone on 4G (customer bundle is 117 KB gzipped initial JS; menu photos ~20–40 KB WebP, lazy-loaded) — do this during the pilot test run.

## What I need from you (before deploying)

Accounts

1. **Domain** you control (e.g. `example.ng`) with DNS on Cloudflare: subdomains for API, customer app, staff app, media — per environment (see RUNBOOK §3).
2. **Google Cloud** project with billing; region choice (see RUNBOOK §9: London / Frankfurt / Johannesburg latency test).
3. **Neon** account: one project (or branch) each for staging and production.
4. **Upstash** Redis database each for staging and production (same region as Cloud Run).
5. **Cloudflare** account: R2 (2 buckets with public custom domains + CORS PUT from the staff app) and 4 Pages projects.
6. **Paystack** business account, verified for live payments; test keys for staging, live keys for production; webhook URL set in both modes.
7. **GitHub** repository (remote `origin` is configured; nothing has been pushed) with environments `staging` and `production` (required reviewers on production).

GitHub environment **variables** (per environment)
`GCP_PROJECT`, `GCP_REGION`, `ARTIFACT_REPO`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `RUNTIME_SERVICE_ACCOUNT`, `API_PUBLIC_URL`, `CUSTOMER_APP_URL`, `STAFF_APP_URL`, `PUBLIC_ASSET_BASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`, `CF_PAGES_CUSTOMER_PROJECT`, `CF_PAGES_STAFF_PROJECT`, optional `MAX_INSTANCES`.

GitHub environment **secrets** (per environment)
`DIRECT_DATABASE_URL` (Neon direct URL, for migrations in CI), `CLOUDFLARE_API_TOKEN` (Pages: Edit).

Google **Secret Manager** secrets (suffix `-staging` / `-production`; read by Cloud Run)
`DATABASE_URL` (Neon pooled URL, `?sslmode=require`), `REDIS_URL` (`rediss://default:<token>@<host>:6379`), `SESSION_SECRET` and `QR_TOKEN_SECRET` (each `openssl rand -base64 48`), `PAYSTACK_SECRET_KEY` (`sk_test_…` staging, `sk_live_…` production), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (R2 token).

Optional env (have defaults): `PAYSTACK_WEBHOOK_SECRET`, `PAYSTACK_FEE_BEARER` (`subaccount`), `PAYSTACK_SUBACCOUNT_PERCENTAGE` (`0`), `PAYMENT_RESERVATION_MINUTES` (15), `RECONCILE_AFTER_MINUTES` (3), `PAYMENT_ABANDON_MINUTES` (60), `PREPAY_ORDER_EXPIRY_MINUTES` (30), rate limits, `COOKIE_DOMAIN`, `CORS_ORIGINS`, `REDIS_KEY_PREFIX`.

After the first deploy: create your platform admin (`pnpm --filter @app/db create-admin`, RUNBOOK §3.9) and run the Paystack test checklist on staging.
