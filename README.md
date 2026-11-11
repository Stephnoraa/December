# QR table ordering (MVP)

Customers scan a QR code on their table, browse the live menu, order and pay from their phone
(Paystack: card, bank transfer, USSD). Orders route to kitchen/bar screens; waiters see a live
floor; owners get a live dashboard and an append-only audit log. Built for a December pilot in
Abuja.

- Spec: [`MVP_BUILD_PROMPT.md`](MVP_BUILD_PROMPT.md) · Status and decisions: [`PROGRESS.md`](PROGRESS.md)
- Conventions: [`CLAUDE.md`](CLAUDE.md) · Operations: [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Pilot setup: [`docs/PILOT_CHECKLIST.md`](docs/PILOT_CHECKLIST.md)

```bash
pnpm install && cp .env.example .env   # set SESSION_SECRET / QR_TOKEN_SECRET
pnpm services:up                       # or: pnpm services:native start (+ STORAGE_DRIVER=local)
pnpm build && pnpm db:deploy && pnpm db:seed
pnpm dev                               # API :3000 · customer :5173 · staff :5174
```
