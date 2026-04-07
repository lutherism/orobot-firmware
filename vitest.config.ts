import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    sourcemap: 'inline'
  },
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
    }
  },
});
