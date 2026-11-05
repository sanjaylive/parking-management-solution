module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false }] },
  testEnvironment: 'node',
  // e2e suites share one Postgres test DB (truncate + seed) — they must never run concurrently.
  maxWorkers: 1,
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};
