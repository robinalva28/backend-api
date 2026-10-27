import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.http.test.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
