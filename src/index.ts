import { createApp } from './main';

createApp().start().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
