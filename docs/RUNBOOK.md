# Runbook

For the person who runs the platform (operator / developer). Covers local setup, deploying,
rolling back, onboarding a venue, rotating QR codes, keys, and day-to-day checks.

- [1. Local setup](#1-local-setup)
- [2. Demo logins](#2-demo-logins)
- [3. First-time cloud setup](#3-first-time-cloud-setup)
- [4. Deploying](#4-deploying)
- [5. Rolling back](#5-rolling-back)
- [6. Onboarding a venue](#6-onboarding-a-venue)
- [7. Rotating QR codes](#7-rotating-qr-codes)
- [8. Rotating secrets and keys](#8-rotating-secrets-and-keys)
- [9. Choosing a region (latency from Nigeria)](#9-choosing-a-region-latency-from-nigeria)
- [10. Operations and troubleshooting](#10-operations-and-troubleshooting)
- [11. End-to-end test against staging](#11-end-to-end-test-against-staging)

---

## 1. Local setup

Requirements: Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`), and either Docker or native
Postgres 14+ and Redis.

```bash
pnpm install
cp .env.example .env            # then set SESSION_SECRET and QR_TOKEN_SECRET (openssl rand -base64 48)

# Services — pick one:
pnpm services:up                # Docker: Postgres, Redis, MinIO (bucket created automatically)
pnpm services:native start      # No Docker: Postgres + Redis under ./.local; then set STORAGE_DRIVER=local in .env

pnpm build                      # builds packages/shared and packages/db (needed once, and after changing them)
pnpm db:deploy                  # apply migrations
pnpm db:seed                    # demo venue "Demo Lounge, Wuse 2, Abuja"
pnpm dev                        # API :3000, customer app :5173, staff app :5174
```

Open the staff app at http://localhost:5174 and the customer menu from **Tables → Open menu
link** (or download the QR sheet and scan a code with your phone on the same network: set
`CUSTOMER_APP_URL` to your machine's LAN address, e.g. `http://192.168.1.20:5173`, and run
the customer app with `pnpm --filter @app/customer dev --host`).

Payments run against the **mock provider** when `PAYSTACK_SECRET_KEY` is empty: "Pay" opens a
test checkout page with "Pay with card (test)" / "Pay by bank transfer (test)" / "Decline".
To use Paystack test mode locally instead, set `PAYSTACK_SECRET_KEY=sk_test_…` and expose the
API publicly for webhooks (e.g. `ngrok http 3000`, then set the webhook URL in the Paystack
dashboard to `https://<ngrok-host>/v1/webhooks/paystack`).

Checks and tests:

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit + integration (Testcontainers, or the env below)
pnpm test:e2e                              # Playwright critical path (needs `pnpm build` and Postgres + Redis)
```

Without Docker, point the integration tests at native services:
`TEST_DATABASE_URL=postgresql://qr:qr@127.0.0.1:5432/postgres TEST_REDIS_URL=redis://127.0.0.1:6379/15 pnpm test`.
The e2e test uses `E2E_DATABASE_URL` (default `postgresql://qr:qr@127.0.0.1:5432/qr_e2e`, recreated
on every run) and `E2E_REDIS_URL` (default `redis://127.0.0.1:6379/14`).

Reset the local database: `pnpm db:reset` (drops everything, re-applies migrations, re-seeds).

## 2. Demo logins

Seeded by `pnpm db:seed` (never seed production).

| Who                   | Sign in                      | Credentials                                           |
| --------------------- | ---------------------------- | ----------------------------------------------------- |
| Owner (Ada Okafor)    | Staff app, email             | `owner@demo.test` / `demo-owner-pass`, PIN `1111`     |
| Manager (Musa Bello)  | Staff app, email             | `manager@demo.test` / `demo-manager-pass`, PIN `2222` |
| Waiter (Chidi Waiter) | PIN pad on an enabled device | PIN `3333`                                            |
| Station screen        | PIN pad on an enabled device | PIN `4444`                                            |
| Platform admin        | Staff app `/platform`        | `admin@platform.test` / `platform-admin-pass`         |

PIN login works only on devices enabled by an owner/manager: sign in with email, go to
**Staff → Enable PIN login on this device**, then **Sign out** to get the PIN pad.

## 3. First-time cloud setup

Target architecture: API on **Cloud Run** (one service per environment), Postgres on **Neon**,
Redis on **Upstash**, menu photos on **Cloudflare R2**, both PWAs on **Cloudflare Pages**,
payments via **Paystack** (test keys on staging, live keys on production).

Use one parent domain so cookies are first-party, e.g. for `example.ng`:

|                                 | Staging                    | Production         |
| ------------------------------- | -------------------------- | ------------------ |
| API (Cloud Run custom domain)   | `api-staging.example.ng`   | `api.example.ng`   |
| Customer app (Pages)            | `order-staging.example.ng` | `order.example.ng` |
| Staff app (Pages)               | `staff-staging.example.ng` | `staff.example.ng` |
| Media (R2 public bucket domain) | `media-staging.example.ng` | `media.example.ng` |

1. **Google Cloud**: create a project; enable Cloud Run, Artifact Registry, Secret Manager,
   IAM Credentials. Create an Artifact Registry Docker repo (e.g. `qr`) in your region.
   Create two service accounts: a _deployer_ (Cloud Run Admin, Artifact Registry Writer,
   Service Account User, Secret Manager viewer) and a _runtime_ account (Secret Manager
   Secret Accessor). Set up Workload Identity Federation for this GitHub repo and allow it to
   impersonate the deployer. Map the API custom domains to the Cloud Run services (or front
   them with a load balancer).
2. **Neon**: create a project per environment (or one project with two branches). Copy the
   **pooled** connection string (host contains `-pooler`, add `?sslmode=require`) for
   `DATABASE_URL`, and the **direct** one for `DIRECT_DATABASE_URL` (migrations).
   Docs: https://neon.com/docs/guides/prisma
3. **Upstash**: create a Redis database in the region closest to Cloud Run. Use the TCP URL
   `rediss://default:<token>@<host>:6379` as `REDIS_URL` (TLS is always on).
   Docs: https://upstash.com/docs/redis/howto/connect-client
4. **Cloudflare R2**: create a bucket per environment, enable public access through a custom
   domain (`media.example.ng`), create an API token with object read/write. Allow CORS `PUT`
   from the staff app origin (photo uploads go straight from the browser to R2):
   `[{"AllowedOrigins":["https://staff.example.ng"],"AllowedMethods":["PUT"],"AllowedHeaders":["content-type"],"MaxAgeSeconds":3600}]`.
   `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`.
5. **Cloudflare Pages**: create four direct-upload projects (customer + staff × staging +
   production) and attach the custom domains. Create an API token with _Pages: Edit_.
6. **Paystack**: business account verified for live mode. In each environment's dashboard
   (test for staging, live for production) set the webhook URL to
   `https://<api-domain>/v1/webhooks/paystack`. Callback URLs are set per transaction by the API.
7. **Secret Manager** (per environment, names suffixed with `-staging` / `-production`):
   `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `QR_TOKEN_SECRET`, `PAYSTACK_SECRET_KEY`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
8. **GitHub**: create environments `staging` and `production` (add required reviewers to
   `production` for the manual approval). Set the variables and secrets listed in PROGRESS.md
   → "What I need from you".
9. Create the platform admin account in each environment (no self-signup):
   ```bash
   DATABASE_URL=<direct url> ADMIN_PASSWORD='<long password>' pnpm --filter @app/db create-admin you@example.ng "Your Name"
   ```
   (`dotenv` falls back to the shell variables when `.env` doesn't set them.)

## 4. Deploying

- **Staging**: merge to `main`. The `Deploy` workflow runs CI, builds the API image, runs
  `prisma migrate deploy` against Neon's direct URL, deploys Cloud Run
  (`infra/cloudrun/service.yaml`: min instances 1, 60-minute request timeout for WebSockets,
  session affinity, CPU always allocated for the scheduler), checks `/readyz`, then builds
  both PWAs with `VITE_API_URL` and uploads them to Cloudflare Pages.
- **Production**: tag a release on `main`: `git tag v1.0.0 && git push origin v1.0.0`. The same
  workflow runs against the `production` environment and waits for approval.
- Migrations are forward-only and run **before** the new revision takes traffic, so every
  migration must be backwards compatible with the running version (add columns as nullable,
  backfill, then tighten in a later release).

## 5. Rolling back

- **API**: route traffic back to the previous revision (instant):
  ```bash
  gcloud run revisions list --service qr-api-production --region $REGION
  gcloud run services update-traffic qr-api-production --region $REGION --to-revisions <previous-revision>=100
  ```
  The next deploy sends traffic to the latest revision again.
- **Frontends**: Cloudflare dashboard → Pages project → Deployments → previous deployment →
  _Rollback to this deployment_.
- **Database**: migrations are not rolled back automatically. If a migration must be undone,
  write a new forward migration. Neon point-in-time restore (branch from a timestamp) is the
  last resort for data loss.

## 6. Onboarding a venue

Goal: under an hour, no developer. The owner can do all of this themselves; see
`docs/PILOT_CHECKLIST.md` for the on-site script.

1. Owner signs up at the staff app (`/signup`): venue name, their name, email, password, PIN.
2. Dashboard checklist walks them through: settings (payment mode, VAT, service charge,
   inclusive pricing, logo) → stations → menu (photos optional) → tables → staff (waiters,
   station logins with PINs) → enable devices → payout bank account (owner only).
3. Print the QR sheet (Tables → Download QR sheet) and stick one code per table.
4. Operator: check the venue on `/platform` (setup status). Suspend/activate there if
   subscriptions lapse (customers see a polite "ordering unavailable" page).

## 7. Rotating QR codes

When a printed code is lost, photographed for pranks, or a table is renumbered:
**Tables → New QR** (one table) or **Replace all QR codes…** (every table). Old codes stop
working immediately ("This QR code has expired"). Print the new sheet and replace the codes.
Every rotation is in the audit log (`QR_ROTATED`).

`QR_TOKEN_SECRET` rotation invalidates **every** printed code at every venue — only do it if
the secret leaked, and plan reprinting with all venues first.

## 8. Rotating secrets and keys

| Secret                          | Effect of rotating                                                           | How                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                | Everyone is signed out (staff, customers, admin); device enablement survives | New Secret Manager version → redeploy                                                                                      |
| `QR_TOKEN_SECRET`               | All printed QR codes stop working                                            | See above                                                                                                                  |
| `PAYSTACK_SECRET_KEY`           | Webhooks signed with the old key fail during the switch                      | Put the old key in `PAYSTACK_WEBHOOK_SECRET` (accepted for signatures), deploy the new key, remove the old one after a day |
| Neon / Upstash / R2 credentials | Brief errors while instances restart                                         | Create new credentials, update secret, redeploy, then revoke the old ones                                                  |

## 9. Choosing a region (latency from Nigeria)

Candidates: `europe-west2` (London), `europe-west3` (Frankfurt), `africa-south1` (Johannesburg).
Measure from venues' real networks (MTN/Airtel/Glo 4G and the venue Wi-Fi), at the busy hour:

1. Deploy a throwaway copy of the API (or any hello-world container) to each region with
   min instances 1.
2. From a phone/laptop in Abuja/Lagos run, per region, 30+ requests:
   ```bash
   for i in $(seq 1 30); do curl -s -o /dev/null -w '%{time_connect} %{time_starttransfer}\n' https://<service-url>/healthz; done
   ```
   Compare median and p95 `time_starttransfer`. https://gcping.com also gives a quick
   browser-side comparison of Google Cloud regions.
3. Put Neon and Upstash in the same (or nearest) region as Cloud Run — DB round trips matter
   more than the phone → API hop.
   Set the chosen region in the `GCP_REGION` GitHub variable.

## 10. Operations and troubleshooting

- **Health**: `/healthz` (process up), `/readyz` (database + Redis). Cloud Run uses `/healthz`.
- **Logs**: Cloud Logging, JSON with `severity`. Useful filters: `context="Payments"`,
  `context="Paystack"`, `context="Scheduler"`, `severity>=WARNING`.
- **A customer paid but the table still shows a balance**: the reconciliation job re-verifies
  pending payments every minute after 3 minutes. Check the payment in the staff tab view; check
  `WebhookEvent` rows for that reference (signature valid? processing error?). Confirm the
  webhook URL in the Paystack dashboard.
- **Refunds due** (dashboard): more was collected than owed. Refund from the Paystack dashboard
  (Transactions → the reference → Refund) or in cash; note it for the venue's records.
- **Owner forgot their password**: `DATABASE_URL=<direct url> pnpm --filter @app/db reset-password owner@venue.ng`
  prints a temporary password and signs them out everywhere.
- **Staff PIN locked**: a manager sets a new PIN (Staff → New PIN), which also unlocks it.
- **Lost or stolen tablet**: Staff → Devices → Remove (signs out every session on it).
- **Audit log**: append-only; database triggers reject UPDATE/DELETE/TRUNCATE. Run the API as a
  database role that does **not** own the tables in production if you want to rule out
  disabling the triggers (Neon: create a role for the app, grant DML only).

## 11. End-to-end test against staging

The Playwright critical path pays through the mock checkout, which real Paystack test mode
cannot automate. To run it against a deployed environment, deploy a second staging service
(e.g. `qr-api-e2e`) from the same image with `APP_ENV=staging`, `ALLOW_MOCK_PAYMENTS=true`,
`PAYMENTS_PROVIDER=mock`, its own Neon branch seeded with the demo venue
(`ALLOW_PRODUCTION_SEED=true pnpm db:seed` against that branch), and Pages preview deployments
pointing at it. Then run the `Deploy` workflow manually (`e2e-staging` job) or locally:

```bash
E2E_BASE_API_URL=https://api-e2e.example.ng E2E_BASE_CUSTOMER_URL=https://order-e2e.example.ng \
E2E_BASE_STAFF_URL=https://staff-e2e.example.ng pnpm test:e2e
```

Real Paystack test-mode payments are covered by the manual `docs/PAYSTACK_TEST_CHECKLIST.md`.
