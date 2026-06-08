#!/usr/bin/env tsx
/**
 * SO-101 Feetech STS3215 BYOD Bridge — standalone entry point.
 *
 * Usage:
 *   npx tsx src/bridges/so101/run.ts
 *
 * One-line install + run (after cloning orobot-firmware):
 *   npm install && npx tsx src/bridges/so101/run.ts
 *
 * Environment variables:
 *   OROBOT_SERIAL_PORT   — serial port for the Feetech bus adapter (default: /dev/ttyACM0)
 *   OROBOT_GATEWAY_URL   — override gateway WS URL (default: wss://robots-gateway-v2.wl.r.appspot.com/)
 *   OROBOT_SERVO_SPEED   — default servo speed in ticks/s; 0 = max speed (default: 0)
 *   OROBOT_DATA_DIR      — directory containing data.json (default: scripts/openroboticsdata)
 *
 * First run: the bridge calls POST /api/device/claim-request, prints a 6-character
 * claim code in your terminal, and waits while you enter the code at orobot.io/devices.
 * Once claimed, the bridge saves a config file at ~/.orobot/so101-config.json and
 * starts connecting to the gateway automatically on every subsequent run.
 *
 * Subsequent runs: the bridge reads the saved config and connects immediately.
 */

import { createSO101Bridge } from './so101-bridge';
import { FeetechProductionBus } from './feetech-bus';

const GATEWAY_URL  = process.env['OROBOT_GATEWAY_URL'];
const SERIAL_PORT  = process.env['OROBOT_SERIAL_PORT'] ?? '/dev/ttyACM0';
const SERVO_SPEED  = Number(process.env['OROBOT_SERVO_SPEED'] ?? '0');

async function main(): Promise<void> {
  console.log('orobot SO-101 bridge starting...');
  console.log(`  Serial port : ${SERIAL_PORT}`);
  console.log(`  Gateway     : ${GATEWAY_URL ?? '(production)'}`);

  const bus = new FeetechProductionBus(SERIAL_PORT);
  const bridge = createSO101Bridge({
    bus,
    gatewayUrl:          GATEWAY_URL,
    servoSpeed:          SERVO_SPEED,
  });

  // Graceful shutdown on Ctrl-C / SIGTERM
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal} — stopping bridge...`);
    await bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  await bridge.start();
  console.log('Bridge connected — controlling your SO-101 from orobot.io!');
}

main().catch((err: unknown) => {
  console.error('Bridge fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
