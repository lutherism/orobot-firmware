// Minimal type declarations for the `i2c-bus` npm package (Raspberry Pi I²C).
// The package has no bundled types — this stub satisfies the TypeScript compiler.
// PCA9685Driver uses `require('i2c-bus')` only on real hardware; tests mock the bus.

declare module 'i2c-bus' {
  interface I2cBus {
    writeByteSync(addr: number, cmd: number, byte: number): void;
    readByteSync(addr: number, cmd: number): number;
    closeSync(): void;
  }

  export function openSync(busNumber: number): I2cBus;
}
