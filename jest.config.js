/** @type {import('jest').Config} */
module.exports = {
  projects: [
    '<rootDir>/frontend',
    '<rootDir>/shared/entity-client',
    '<rootDir>/scripts',
    '<rootDir>/services/attendance-service',
    '<rootDir>/services/auth-service',
    '<rootDir>/services/employee-service',
    '<rootDir>/services/leave-service',
    '<rootDir>/services/payroll-service',
    '<rootDir>/services/performance-service',
    '<rootDir>/services/support-service',
    '<rootDir>/services/training-service',
    // Added 2026-08 alongside their docker-compose entries. These services had
    // test files that npm run test:backend never executed, because a project
    // absent from this array is silently skipped — no error, no warning.
    '<rootDir>/services/benefits-service',
    '<rootDir>/services/esign-service',
    '<rootDir>/services/hr-case-service',
    '<rootDir>/services/loans-service',
    '<rootDir>/services/survey-service',
    '<rootDir>/services/statutory-sg-service',
    '<rootDir>/services/statutory-my-service',
  ],
};
