-- Append-only audit log: reject UPDATE, DELETE and TRUNCATE for every role.
-- (Only a superuser or the table owner disabling the trigger can bypass this; the runtime
-- role in production should not own the table — see docs/ARCHITECTURE.md.)
CREATE OR REPLACE FUNCTION audit_event_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_reject_mutation();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_reject_mutation();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_reject_mutation();

-- At most one live (non-closed) session per table: two waiters tapping "open" at the same
-- moment cannot create two tabs.
CREATE UNIQUE INDEX "TableSession_one_live_per_table"
  ON "TableSession" ("tableId")
  WHERE status <> 'CLOSED';

-- Money columns can never go negative.
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_price_nonneg" CHECK ("priceKobo" >= 0);
ALTER TABLE "MenuAddOn" ADD CONSTRAINT "MenuAddOn_price_nonneg" CHECK ("priceDeltaKobo" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_amounts_valid"
  CHECK ("unitPriceKobo" >= 0 AND "basePriceKobo" >= 0 AND quantity > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountKobo" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_overpaid_valid"
  CHECK ("overpaidKobo" >= 0 AND "overpaidKobo" <= "amountKobo");
ALTER TABLE "Tab" ADD CONSTRAINT "Tab_amounts_nonneg"
  CHECK ("totalKobo" >= 0 AND "paidKobo" >= 0 AND "balanceKobo" >= 0 AND "overpaidKobo" >= 0);
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_rates_valid"
  CHECK ("vatBps" BETWEEN 0 AND 10000 AND "serviceChargeBps" BETWEEN 0 AND 10000);
