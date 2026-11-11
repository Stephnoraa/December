# Build Brief: QR Table Ordering — MVP

You are building the MVP of a hosted, multi-tenant web platform that lets restaurants, bars and lounges in Nigeria (starting in Abuja) take orders and payments from customers' phones via QR codes. The goal is a product venues will pay for, piloted at 2–3 venues during the December rush. Speed to a reliable pilot matters more than breadth.

Read this whole document before writing code. It is the source of truth for scope and conventions. Anything not listed in Section 2 is out of scope.

---

## 0. How to work

1. Read everything, then send me a short implementation plan (milestones, schema, open questions). Wait for approval before coding.
2. First code task: create `CLAUDE.md` (condensed conventions: stack, layout, commands, money rules, tenancy rules, testing rules) and `PROGRESS.md` (milestone status, decisions, open questions). Keep both updated.
3. Work milestone by milestone (Section 9). Each milestone ends with lint, typecheck and tests passing, a commit, and a short summary to me of what changed and how to verify it.
4. **Stay in scope.** Do not build anything from Section 3 ("Out of scope"). If something seems necessary, ask first. Keep the code simple enough that those features can be added later.
5. Ask me about business decisions. Make reasonable engineering decisions yourself and log them in `PROGRESS.md`.
6. Check official docs (Paystack, Cloud Run, Neon, Upstash) before integrating. Don't rely on memory for endpoints, parameters or signature schemes; cite the doc URL in a code comment.
7. No secrets in code. All config via validated environment variables, with a complete `.env.example`.

---

## 1. Stack (decided)

| Concern | Choice |
|---|---|
| Language | TypeScript, `strict: true` |
| Monorepo | pnpm workspaces + Turborepo |
| Backend | NestJS, Node LTS |
| ORM / DB | Prisma + PostgreSQL (Neon hosted: pooled URL at runtime, direct URL for migrations; Docker locally) |
| Realtime | Socket.IO via NestJS gateways, Redis adapter (Upstash hosted, Docker locally). Redis is used **only** for Socket.IO and rate limiting in the MVP; no job queue |
| Scheduled work | Lightweight in-process scheduler (`@nestjs/schedule`) for payment reconciliation |
| Validation | zod schemas in a shared package |
| Frontends | Two React + Vite + TypeScript PWAs, TanStack Query, React Router, Tailwind |
| Images | S3-compatible storage (Cloudflare R2 hosted, MinIO locally), pre-signed uploads, resized to small WebP with sharp |
| Hosting | API on Google Cloud Run; frontends on Cloudflare Pages |
| Payments | Paystack |
| Tests | Vitest/Jest unit tests, Testcontainers (Postgres + Redis) integration tests, one Playwright end-to-end test |
| CI | GitHub Actions |

Layout:

```
/apps/api        NestJS API + Socket.IO
/apps/customer   Customer ordering PWA
/apps/staff      Staff PWA: waiter, station screen, manager, owner dashboard, platform admin (role-based routes)
/packages/db     Prisma schema, migrations, seed
/packages/shared zod schemas, types, enums, event names, money utilities
/infra           Dockerfile, docker-compose.yml (postgres, redis, minio), deploy notes
```

Commands: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm db:migrate`, `pnpm db:seed`.

---

## 2. MVP scope (build exactly this)

### 2.1 Venue setup (owner/manager, staff app)
- Owner signs up with email + password, creates one venue. (Data model allows several venues per organization, but the UI handles one.)
- Settings: venue name, logo, payment mode (`PREPAY` or `POSTPAY`), VAT % (default 7.5), service charge % (default 0), prices VAT-inclusive or exclusive.
- Paystack onboarding: owner enters settlement bank and account number; the platform resolves the account name and creates a Paystack **sub-account** for the venue (verify the endpoints in Paystack docs). Venue cannot accept online payments until this is done.
- Stations: create stations (e.g. Kitchen, Bar).
- Tables: create tables with a label and optional area name. Generate a printable PDF of QR codes (one per table, with table label and short instructions).
- Menu: categories; items (name, description, price, photo, station, available toggle); simple optional add-ons per item (name + price delta, e.g. "Extra plantain +₦500", "With ice +₦0"); customers can also add a free-text note per item.
- Staff: add staff with name, role (`OWNER`, `MANAGER`, `WAITER`, `STATION`) and a 4–6 digit PIN.
- A setup checklist on the dashboard until the venue is ready to go live.

### 2.2 Table sessions (anti-prank)
- QR URL: `https://<customer-app>/t/<venueSlug>/<tableToken>`, where `tableToken` is HMAC-signed (venueId, tableId, version). Rotating the version invalidates old printed codes.
- If the table has no open session, the customer sees the menu **read-only**, a message to ask the waiter to open the table, and a **Call waiter** button.
- A waiter taps the table in the staff app to open a session. Ordering unlocks live for anyone who already scanned.
- Everyone who scans an open table joins the same session and tab via an anonymous signed cookie. Rescanning restores it. No customer login, ever.
- Staff close the session once the tab is paid.

### 2.3 Customer ordering (customer PWA)
- Fast on mobile data: small bundle (target under 200 KB gzipped initial JS), compressed images, skeleton loading states.
- Browse by category, item detail with add-ons and note, cart, submit order.
- Live per-item status: Sent → Accepted / Unavailable → Ready → Served. Unavailable items are clearly marked and not charged.
- Live tab: items, subtotal, VAT, service charge, total, paid, balance due.
- **Call waiter** and **Request bill** buttons.
- **PREPAY venues:** an order is only sent to stations after it is paid. **POSTPAY venues:** orders go to stations immediately and the tab is paid at the end.

### 2.4 Station screen (staff PWA, STATION role)
- Runs on a cheap Android tablet. Shows incoming items for that station, grouped by table, oldest first, with time since ordered.
- Per item: **Accept** or **Unavailable**, then **Ready**. Unavailable also switches the menu item off venue-wide (with a one-tap undo).
- Large buttons, high contrast, sound alert on new items (enabled by a tap when the screen starts).

### 2.5 Waiter view (staff PWA, WAITER role)
- Table grid with live status: closed, open, items ready, waiter called, bill requested, balance due.
- Open/close tables, acknowledge call-waiter and bill requests, mark items served, view a table's tab.
- Record cash or POS-terminal payments against a tab (amount + method).

### 2.6 Payments
- Customer taps **Pay**: chooses the full balance or enters a custom amount (this covers bill splitting; several people can pay parts). In PREPAY mode the amount is the order total.
- Customer enters an email (required by Paystack) and pays via Paystack checkout with card, bank transfer and USSD enabled. The transaction carries the venue's sub-account so funds settle to the venue.
- **A payment counts only after server-side confirmation:** Paystack webhook with signature verified against the raw body exactly as Paystack documents, plus the verify-transaction endpoint. Handle webhooks idempotently by reference and store the raw event. Never trust the browser redirect alone.
- Concurrent partial payments must be safe: the sum of successful payments may not silently exceed the balance (lock or version the tab; flag any overpayment for a refund).
- Reconciliation: a scheduled task re-verifies pending payments older than a few minutes.
- When the balance reaches zero the tab is marked paid and staff see it immediately.
- Customer sees an on-screen receipt with a shareable link.

### 2.7 Owner controls
- Staff log in on venue devices with their PIN. Owners/managers can also log in with email + password from any phone.
- **Voids and discounts** (amount or percent, on an item or the whole tab) require a manager or owner PIN at the moment of the action, with a reason.
- **Append-only audit log** of voids, discounts, cash/POS payments, table open/close, menu availability changes and settings changes. Enforce at database level with triggers that reject UPDATE and DELETE.
- Owner dashboard (mobile-friendly, live): today's sales total, open tabs with balances, payments by method (card, transfer, USSD, cash, POS), list of voids and discounts with who approved them.

### 2.8 Platform admin (you, the operator)
- A super-admin role (seeded, not self-signup) with a minimal screen: list venues, see setup status, activate/suspend a venue (suspended venues show a polite "ordering unavailable" page). Subscription fees are collected outside the app for now.

---

## 3. Out of scope for the MVP (do not build)

Thermal printers; offline mode / outbox sync; itemised or even-split bill tools; modifier rules (required groups, min/max); extra levies beyond VAT and service charge; email and WhatsApp receipts; deposits, reservations, minimum spends; tips; loyalty; reports beyond the owner dashboard; time-based menus; combos; multi-branch UI; inventory; integration API and webhooks; embeddable widgets; self-hosting and licences; automated subscription billing; 2FA (add later; keep auth code structured to allow it).

---

## 4. Rules that apply everywhere

- **Money:** integers in kobo, never floats. One shared money module for arithmetic, rounding (half-up) and `en-NG` NGN formatting. Prices snapshotted onto order items when ordered.
- **Tab totals:** computed by one pure, heavily tested function (subtotal → discounts → service charge → VAT → total; handle inclusive and exclusive VAT).
- **Tenancy:** every tenant-owned row has `venueId`. Scope all queries centrally (Prisma extension + request context via AsyncLocalStorage). Tests must prove one venue cannot read or write another's data.
- **Idempotency:** mutating endpoints accept an `Idempotency-Key` header; duplicates return the original response.
- **Time:** store UTC, display in `Africa/Lagos`.
- **Security:** argon2 for passwords and PINs; PIN attempt limits with lockout; rate limiting on public endpoints; zod validation on every input; helmet; strict CORS; signed HttpOnly cookies.
- **Realtime:** socket events notify, REST is the source of truth. On reconnect, clients refetch. Tabs and orders carry a `version` so stale events are ignored. Rooms: venue, station, table session, owner.
- **Privacy (Nigeria Data Protection Act):** collect only the customer email needed for payment; no marketing use without consent.

---

## 5. Data model (starting point)

Organization, Venue (settings above, paystackSubaccountCode, status ACTIVE/SUSPENDED), Station, Table (label, area, qrVersion), MenuCategory, MenuItem (priceKobo, stationId, imageKey, isAvailable), MenuAddOn (itemId, name, priceDeltaKobo, isAvailable), StaffMember (role, pinHash, email/passwordHash for owners/managers), TableSession (status AWAITING_OPEN/OPEN/CLOSED, openedBy), CustomerSession (anonymous device token), Tab (status OPEN/PAID/CLOSED, version), Order (status, AWAITING_PAYMENT used in prepay), OrderItem (snapshot name/price/add-ons, note, qty, stationId, status SENT/ACCEPTED/UNAVAILABLE/READY/SERVED/VOIDED, timestamps), Adjustment (VOID/DISCOUNT, amount, reason, requestedBy, approvedBy), Payment (amountKobo, method PAYSTACK/CASH/POS, channel, status PENDING/SUCCESS/FAILED, reference, recordedBy), ServiceRequest (CALL_WAITER/REQUEST_BILL, status), AuditEvent (append-only), WebhookEvent, IdempotencyRecord.

---

## 6. Seed data

A demo venue, "Demo Lounge, Wuse 2, Abuja": stations Kitchen and Bar; 12 tables across Main Hall, Terrace and VIP; menu with jollof rice, fried rice, peppered goat meat, catfish pepper soup, suya, small chops, plantain, Chapman, Zobo, bottled water, lager (bottle), spirits by shot; add-ons like extra plantain, with ice, extra pepper; one staff member per role with known dev PINs; one super-admin.

---

## 7. Testing (minimum bar)

- Unit: money, tab-total calculation (inclusive/exclusive VAT, discounts, voids), order-item and table-session state machines, PIN/permission checks.
- Integration (Testcontainers): tenant isolation, idempotency, audit-log immutability, Paystack webhook signature check and duplicate events, concurrent partial payments, prepay order release on payment.
- One Playwright end-to-end test of the critical path: waiter opens table → two customer browsers order → station accepts one item and marks one unavailable → items ready and served → one customer pays part via mocked Paystack, waiter records the rest as cash → tab paid → owner dashboard shows correct totals and the audit trail.
- Paystack behind a `PaymentProvider` interface, mocked in automated tests. Also write a short manual checklist for Paystack test mode.

---

## 8. Deployment

- One Dockerfile for the API (multi-stage, non-root). Deploy to Cloud Run with **min instances = 1** (no cold starts during service), WebSockets enabled, a long request timeout and session affinity. Region configurable; note in docs how to compare latency from Nigeria for London, Frankfurt and Johannesburg.
- Run `prisma migrate deploy` against Neon's direct URL in CI before releasing.
- Frontends built and deployed to Cloudflare Pages with the API URL injected at build time.
- GitHub Actions: lint, typecheck, tests, build, deploy to staging on `main`; production on a tagged release.
- Staging uses Paystack test keys. A `/docs/RUNBOOK.md` covers: local setup, deploy, rollback, onboarding a venue, rotating QR codes.

---

## 9. Milestones

- **M0 – Scaffold:** monorepo, tooling, docker-compose, CI, health endpoints, env validation, `CLAUDE.md`, `PROGRESS.md`.
- **M1 – Data & auth:** Prisma schema, migrations (with audit triggers), tenancy scoping, idempotency, seed; owner signup/login, staff PIN login, roles and guards, super-admin.
- **M2 – Venue setup:** settings, stations, tables, QR tokens + printable PDF, menu with photos and add-ons, setup checklist.
- **M3 – Ordering loop:** realtime layer, table sessions, customer PWA (menu, cart, order, live status, live tab, call waiter, request bill), station screen, waiter view.
- **M4 – Payments:** tab calculation, Paystack sub-account onboarding, checkout, webhook + verify, reconciliation, partial payments, prepay flow, cash/POS recording, on-screen receipt.
- **M5 – Owner controls:** voids/discounts with manager PIN, audit log view, owner live dashboard, platform admin screen.
- **M6 – Ship:** end-to-end test green, staging and production deploys, runbook, a pilot checklist for setting up a real venue in under an hour.

---

## 10. Done means

- A real venue can be set up and taking QR orders in under an hour without a developer.
- Nobody can order to a table a waiter hasn't opened.
- No tab shows as paid without a verified Paystack payment or a staff-recorded cash/POS entry.
- Every void and discount shows who approved it, and the audit log cannot be edited.
- The customer menu loads quickly on a mid-range Android phone on 4G.
- The critical-path end-to-end test passes against staging.

Start by sending me your plan and questions.
