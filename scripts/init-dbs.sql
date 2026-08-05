-- Initialize all per-service databases
CREATE DATABASE hrms_auth;
CREATE DATABASE hrms_employee;
CREATE DATABASE hrms_payroll;
CREATE DATABASE hrms_leave;
CREATE DATABASE hrms_claims;
CREATE DATABASE hrms_recruitment;
CREATE DATABASE hrms_attendance;
CREATE DATABASE hrms_offboarding;
CREATE DATABASE hrms_notification;
CREATE DATABASE hrms_reporting;
CREATE DATABASE hrms_admin;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE hrms_auth TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_employee TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_payroll TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_leave TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_claims TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_recruitment TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_attendance TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_offboarding TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_notification TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_reporting TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_admin TO hrms;

-- Databases for services that were gateway-routed but had no compose entry
-- until 2026-08. Note: this file only runs on FIRST postgres init (empty data
-- dir), so existing deployments must create these manually.
CREATE DATABASE hrms_support;
CREATE DATABASE hrms_esign;
CREATE DATABASE hrms_benefits;
CREATE DATABASE hrms_hr_case;
CREATE DATABASE hrms_loans;
CREATE DATABASE hrms_survey;

GRANT ALL PRIVILEGES ON DATABASE hrms_support  TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_esign    TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_benefits TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_hr_case  TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_loans    TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_survey   TO hrms;

-- Pre-existing gap, unrelated to the six services above: these three are
-- referenced by docker-compose.yml but were never created here, so a genuinely
-- fresh boot left asset/performance/training unable to start.
CREATE DATABASE hrms_asset;
CREATE DATABASE hrms_performance;
CREATE DATABASE hrms_training;

GRANT ALL PRIVILEGES ON DATABASE hrms_asset       TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_performance TO hrms;
GRANT ALL PRIVILEGES ON DATABASE hrms_training    TO hrms;

-- Singapore statutory rate tables (global, platform-managed — no tenantId).
CREATE DATABASE hrms_statutory_sg;
GRANT ALL PRIVILEGES ON DATABASE hrms_statutory_sg TO hrms;

-- Malaysian statutory rate tables (global, platform-managed — no tenantId).
-- Separate database from the Singapore sibling: the tables share no rows and a
-- country's rate revision must never be able to touch another country's data.
CREATE DATABASE hrms_statutory_my;
GRANT ALL PRIVILEGES ON DATABASE hrms_statutory_my TO hrms;
