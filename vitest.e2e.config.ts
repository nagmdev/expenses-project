import { defineConfig } from 'vitest/config';

// Seeds the local end-to-end environment (Firebase emulators). See tests-e2e/seed.seed.ts.
export default defineConfig({
  test: {
    include: ['tests-e2e/**/*.seed.ts'],
    environment: 'node',
    fileParallelism: false,
  },
});
