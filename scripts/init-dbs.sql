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
