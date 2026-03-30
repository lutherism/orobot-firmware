import { createApp } from './main';

const app = createApp();

process.on('SIGTERM', () => { app.stop(); process.exit(0); });
process.on('SIGINT',  () => { app.stop(); process.exit(0); });

app.start().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
