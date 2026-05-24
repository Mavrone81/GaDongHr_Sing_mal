-- AddColumn: carryForwardExpiry on leave_entitlements (LEA-007)
-- Default expiry for any prior-year carry-forward = 31 Dec of that year
-- at 23:59:59 Singapore time (UTC+8). Existing rows are populated from the
-- entitlement `year` column; new rows let the application layer set it.
ALTER TABLE "leave_entitlements"
  ADD COLUMN IF NOT EXISTS "carryForwardExpiry" TIMESTAMP(3);

-- Backfill historical rows. 23:59:59 SGT = 15:59:59 UTC.
UPDATE "leave_entitlements"
SET "carryForwardExpiry" = make_timestamptz("year", 12, 31, 23, 59, 59, 'Asia/Singapore')
WHERE "carryForwardExpiry" IS NULL;

-- Index used by the daily expiry sweep (lte: now AND carryForward > 0)
CREATE INDEX IF NOT EXISTS "leave_entitlements_carryForwardExpiry_idx"
  ON "leave_entitlements" ("carryForwardExpiry");
