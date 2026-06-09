#!/usr/bin/env tsx
/**
 * PCA9685 Multi-Servo ARM Bridge — standalone entry point.
 *
 * Usage:
 *   npx tsx src/bridges/pca9685-arm/run.ts
 *
 * Environment variables:
 *   OROBOT_GATEWAY_URL  — override gateway WS URL (default: production)
 *   OROBOT_DATA_DIR     — directory containing data.json (default: scripts/openroboticsdata)
 *   OROBOT_I2C_BUS      — I²C bus number (default: 1 on Raspberry Pi)
 *   OROBOT_I2C_ADDR     — PCA9685 I²C address in hex, e.g. 0x40 (default: 0x40)
 *
 * First run: prints a 6-character claim code; enter it at orobot.io/devices.
 * Subsequent runs: reads ~/.orobot/pca9685-arm-config.json and connects directly.
 *
 * To use a custom joint config (e.g. InMoov), import your config and pass it
 * to createPCA9685ArmBridge({ config: YOUR_CONFIG }).
 */

import { createPCA9685ArmBridge } from './pca9685-arm-bridge';
import { PCA9685Driver } from '../../drivers/pca9685';
import { GENERIC_ARM_6DOF } from './arm-servo-map';

const GATEWAY_URL = process.env['OROBOT_GATEWAY_URL'];
const I2C_BUS     = Number(process.env['OROBOT_I2C_BUS']  ?? '1');
const I2C_ADDR    = Number(process.env['OROBOT_I2C_ADDR']  ?? '0x40');

async function main(): Promise<void> {
  console.log('orobot PCA9685 Arm bridge starting...');
  console.log(`  I²C bus    : ${I2C_BUS}`);
  console.log(`  I²C address: 0x${I2C_ADDR.toString(16)}`);
  console.log(`  Gateway    : ${GATEWAY_URL ?? '(production)'}`);
  console.log(`  Config     : GENERIC_ARM_6DOF (${GENERIC_ARM_6DOF.joints.length} joints)`);

  const driver = new PCA9685Driver({ busNumber: I2C_BUS, address: I2C_ADDR });

  const bridge = createPCA9685ArmBridge({
    config:     GENERIC_ARM_6DOF,
    driver,
    gatewayUrl: GATEWAY_URL,
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal} — stopping bridge...`);
    await bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  await bridge.start();
  console.log('Bridge connected — controlling your arm from orobot.io!');
}

main().catch((err: unknown) => {
  console.error('Bridge fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
