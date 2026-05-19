-- AddColumn: minServiceMonths to LeaveType
-- MOM compliance: minimum months of service required before an employee
-- can apply for this leave type (e.g. 3 months for annual leave)
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "minServiceMonths" INTEGER NOT NULL DEFAULT 0;
