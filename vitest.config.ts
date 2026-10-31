import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    env: { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:54329/approach_test' },
  },
});
