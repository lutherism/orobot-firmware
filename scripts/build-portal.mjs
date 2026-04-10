/**
 * Build the captive portal React app into public/portal.js.
 * Run via: node scripts/build-portal.mjs
 * Or: npm run build:portal
 */
import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await esbuild.build({
  entryPoints: [path.join(root, 'src/portal/index.tsx')],
  bundle:      true,
  outfile:     path.join(root, 'public/portal.js'),
  platform:    'browser',
  target:      'es2017',
  jsx:         'automatic',
  jsxImportSource: 'react',
  define:      { 'process.env.NODE_ENV': '"production"' },
  minify:      true,
  logLevel:    'info',
});
