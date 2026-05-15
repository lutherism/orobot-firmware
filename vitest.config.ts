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
      thresholds: {
        'src/core/**/*.ts':    { functions: 96 },
        'src/network/**/*.ts': { functions: 95 },
        'src/gait/**/*.ts':    { functions: 100 },
        'src/drivers/**/*.ts': { functions: 100 },
      },
    }
  },
});
