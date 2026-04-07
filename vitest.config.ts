import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    sourcemap: 'inline'
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Legacy CRA-era test file
      'src/App.test.js',
    ],
    passWithNoTests: true,
    coverage: {
      enabled: true,
      provider: 'v8',
    }
  },
});
