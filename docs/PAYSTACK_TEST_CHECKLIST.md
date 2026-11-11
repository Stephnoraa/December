# Paystack test-mode checklist (manual)

Run on **staging** (Paystack test keys) before the pilot and after any payment change.
Test cards and bank details: https://paystack.com/docs/payments/test-payments/

Setup

- [ ] Staging API has `PAYSTACK_SECRET_KEY=sk_test_…`; `/readyz` is ready.
- [ ] Paystack dashboard (test mode) → Settings → API Keys & Webhooks → webhook URL is
      `https://<staging-api>/v1/webhooks/paystack`.
- [ ] Owner completes **Settings → Payouts** with a test bank account; the account name
      resolves and a sub-account code (`ACCT_…`) appears. Paystack dashboard → Subaccounts
      shows it.

Card

- [ ] Open a table, order from a phone, **Pay → full balance**, pay with the success test card.
- [ ] Back on the table page: "Payment received", balance 0, waiter's tab shows _paid_ within
      seconds, dashboard "Card" increases.
- [ ] Paystack dashboard transaction shows the venue sub-account and metadata (venueId, tabId).
- [ ] Repeat with a declining test card: page shows "Payment not completed", balance unchanged.

Bank transfer and USSD

- [ ] Pay part of a bill with **bank transfer** (test mode simulates the transfer). The table
      updates when Paystack confirms, without anyone refreshing; dashboard "Bank transfer".
- [ ] Pay with **USSD** (test flow); dashboard "USSD".

Split and concurrency

- [ ] Two phones on one table: phone A starts "pay full balance" (leave checkout open);
      phone B is told someone is paying. A completes; B can then pay nothing / is told nothing is due.
- [ ] Phone A pays part (custom amount), phone B pays the rest; waiter sees PAID; close table.

Resilience

- [ ] Temporarily set a wrong webhook URL; pay; within ~4 minutes reconciliation marks the
      payment successful anyway (Cloud Run logs: `Scheduler`). Restore the URL.
- [ ] Resend a webhook from the Paystack dashboard: no double payment (audit log has one
      "Online payment confirmed" for the reference).
- [ ] Close checkout without paying, tap "I didn't pay, cancel": the balance is free again.

PREPAY

- [ ] Switch the venue to _pay before_, order: station screen shows nothing until paid; after
      paying, items appear on the station screen.
- [ ] Mark a paid item unavailable: dashboard "Refunds due" lists the amount.

Go-live

- [ ] Production uses `sk_live_…`, webhook URL set in **live** mode, owner re-does Payouts in
      production (test sub-accounts don't exist in live mode).
