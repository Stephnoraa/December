# Architecture

## Pieces

```
Customer phone ──HTTPS──▶ Customer PWA (Cloudflare Pages) ──REST + Socket.IO──┐
Staff tablets  ──HTTPS──▶ Staff PWA (Cloudflare Pages)    ──REST + Socket.IO──┤
Paystack ─────────────── webhook (HMAC-SHA512) ───────────────────────────────┤
                                                                              ▼
                                                  API: NestJS on Cloud Run (min 1 instance)
                                                   │  Prisma (tenancy extension)  │ Socket.IO + Redis adapter
                                                   ▼                              ▼
                                            Postgres (Neon)               Redis (Upstash): pub/sub,
                                            incl. append-only audit       rate limits, scheduler lock
                                                   │
                                            R2 (menu photos, logos)
```

## Request flow and tenancy

1. `tenantContextMiddleware` opens an empty AsyncLocalStorage context for each request.
2. Guards authenticate from HttpOnly cookies (`qr_staff`, `qr_customer`, `qr_admin`) and call
   `tenancy.bindVenue(venueId)`. Public routes bind after verifying the table QR token.
3. Every Prisma query on a tenant model goes through the tenancy extension, which ANDs
   `venueId = <bound venue>` into reads/updates/deletes and sets/checks it on creates. No
   context → error. Cross-venue work (signup, webhooks before the venue is known, scheduler,
   platform admin) must call `tenancy.runAsSystem()` explicitly.
4. Limits: nested writes and raw SQL are not rewritten. Code creates tenant rows with an
   explicit `venueId`; raw SQL (row locks) filters on `"venueId"` itself.
5. Tests prove cross-venue reads and writes fail at the extension level (`packages/db/test/tenancy.test.ts`)
   and over HTTP (`apps/api/test/setup.test.ts`).

## Money

Integer kobo everywhere. `packages/shared/src/money.ts` does arithmetic and half-up rounding
(BigInt for division) and en-NG formatting. `calculateTab()` is the single source of totals:
subtotal → item discounts → whole-tab discounts → service charge → VAT → total, for
VAT-inclusive or -exclusive prices; each charge rounds once so the breakdown sums exactly.
Tabs cache the result with a monotonic `version`; every change that affects the bill calls
`TabsService.recalculate(tx, …)` inside the same transaction, under a row lock.

## Ordering and realtime

- A waiter opens a table → `TableSession` (partial unique index: one live session per table)
  - `Tab` with the venue's charge settings snapshotted.
- Customers join with an anonymous signed cookie; ordering requires an OPEN session.
- Order items snapshot name, base price, add-ons and unit price. PREPAY orders wait in
  `AWAITING_PAYMENT` and are invisible to stations until paid.
- Item lifecycle: SENT → ACCEPTED | UNAVAILABLE; ACCEPTED → READY → SERVED; billable → VOIDED
  (manager PIN). Transitions are conditional updates (`WHERE status = <from>`).
- After each commit the API emits small Socket.IO events (ids + version) to rooms:
  `venue:*`, `owner:*`, `station:*`, `table-session:*`, `table:*` (read-only scanners),
  `venue-menu:*`. Clients refetch over REST, ignore stale versions, and refetch everything on
  reconnect. The Redis adapter fans events out across Cloud Run instances.

## Payments

`PaymentProvider` interface → `PaystackProvider` (real) or `MockPaymentProvider` (tests/dev).

1. Customer starts a payment: tab locked, amount computed (full/custom/order), pending
   `Payment` created with a reservation window, Paystack transaction initialised with the
   venue sub-account and `callback_url` back to the table page.
2. Confirmation from any trigger (webhook, the customer returning, reconciliation) calls
   `verify` and records SUCCESS only if Paystack says `success` in NGN. Idempotent by
   reference; tab and payment rows locked; PREPAY orders released; overpayment flagged.
3. Webhooks: raw body stored (dedupe by hash), signature checked, unknown references acked.
4. Scheduler (every minute, Redis lock): re-verify pending > 3 min; fail > 60 min; cancel
   unpaid PREPAY orders > 30 min.

## Audit

`AuditEvent` is append-only: triggers reject UPDATE, DELETE and TRUNCATE for every role.
Written in the same transaction as the change for: table open/close, cash/POS payments,
online confirmations, overpayments, voids, discounts (with approver), menu availability,
settings, payout, staff changes, PIN lockouts, QR rotation, device enablement, venue
suspension.

## Phase-2 hooks (not built)

Kept simple so these slot in later: `TableSessionStatus.AWAITING_OPEN` (staff-confirms-first-order
policy), `Organization` → many venues (multi-branch), `StaffSession` (2FA step-up flag),
`PaymentProvider` (other providers), `WebhookEvent` (replay tooling), `ServiceRequest` types.
