declare module 'node-libgpiod' {
  export function version(): string;
  export class Chip {
    constructor(index: number);
  }
  export class Line {
    constructor(chip: Chip, offset: number);
    requestOutputMode(): void;
    setValue(value: 0 | 1): void;
    release(): void;
  }
}
