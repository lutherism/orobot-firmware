// Minimal type declarations for the `gpio` npm package.
// The package has no @types — this stub satisfies the TypeScript compiler.
// Only RPiGPIODriver imports from 'gpio'; tests use MockGPIODriver instead.
declare module 'gpio' {
  interface GpioPin {
    set(value: 0 | 1, cb?: () => void): void;
    unexport(cb?: () => void): void;
  }

  const gpio: {
    export(
      pin: number,
      options: {
        direction: 'in' | 'out';
        interval?: number;
        ready?: () => void;
      }
    ): GpioPin;
    logging: boolean;
  };

  export = gpio;
}
