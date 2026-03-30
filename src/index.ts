import { createApp } from './main';

const app = createApp();

process.on('SIGTERM', () => { void app.stop().then(() => process.exit(0)); });
process.on('SIGINT',  () => { void app.stop().then(() => process.exit(0)); });

app.start().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
