const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/**
 * jsdom, not node.
 *
 * The existing frontend tests are pure logic (attendanceUtils, timezone), so
 * component rendering was never set up here — no jsdom, no testing-library, and
 * testMatch excluded .tsx entirely. Component tests were therefore not merely
 * failing, they were never DISCOVERED. The Official Record primitives have to
 * be rendered to be worth testing at all.
 *
 * @type {import("jest").Config}
 */
module.exports = {
  testEnvironment: "jsdom",
  // Override the ts-jest default pattern rather than adding a second one:
  // the default key ^.+\.tsx?$ also matches .tsx and, being first, wins — so an
  // extra entry never applies and JSX reaches the runtime untransformed.
  // frontend/tsconfig.json sets jsx: "preserve" for Next.js, which is correct
  // for the build and wrong for tests.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
