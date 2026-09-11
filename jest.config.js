/**
 * Jest configuration.
 *
 * Uses ts-jest to run TypeScript tests directly. Tests live in `test/` and
 * mirror the `src/` layout (see ARCHITECTURE.md).
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    // Aggregate bar. Branches are lower than the rest because the Kerberos
    // (SPNEGO) interceptor in src/sharepoint/auth.ts and the stdio/gateway
    // process bootstraps require a real domain/host and are integration-only.
    // The three core business-logic modules named in the build prompt (health
    // scoring, delay analysis, permission filtering) are each held at ≥80%
    // statements/lines — see TESTING.md for the per-file numbers.
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
