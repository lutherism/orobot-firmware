declare module 'node-libgpiod' {
  export class Chip {
    constructor(index: number);
    getLine(offset: number): Line;
  }
  export class Line {
    requestOutputMode(consumer: string): void;
    setValue(value: 0 | 1): void;
    release(): void;
  }
}
