import { defineConfig } from 'vitest/config';

// Security-rules tests run against the Firestore emulator (needs Java 11+):
//   npm run test:rules
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests-rules/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
