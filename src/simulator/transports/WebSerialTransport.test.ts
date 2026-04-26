import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WebSerialTransport,
  buildDisplayName,
  chipMatchesDistribution,
  ERROR_CATALOG,
  type LoaderFactory,
} from './WebSerialTransport';
import { ERR_INSTALL_CANCELLED, type Distribution, type InstallCallbacks } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const distribution: Distribution = {
  id: 'esp32',
  type: 'esp32',
  label: 'ESP32',
  description: '',
  targetKind: 'serial-port',
  binaries: {
    bootloader:  { url: '/api/firmware/esp32/bootloader',  flashAddress: 0x1000 },
    application: { url: '/api/firmware/esp32/application', flashAddress: 0x10000 },
  },
  boardIds: ['esp32', 'esp32-s3'],
};

function fakePort(info?: { usbVendorId?: number; usbProductId?: number }): unknown {
  return { getInfo: () => info ?? {} };
}

function fakeSerial(port: unknown) {
  return { requestPort: vi.fn(async () => port) };
}

function fakeFetch(body = new Uint8Array([1, 2, 3, 4])) {
  return vi.fn(async (_url: string) => ({
    ok: true,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    status: 200,
  }) as unknown as Response);
}

function fakeLoaderFactory(opts: {
  chipName?: string;
  mainThrows?: Error;
  writeFlashImpl?: (o: any) => Promise<void>;
}): { factory: LoaderFactory; loader: any; transport: any } {
  const transport = { disconnect: vi.fn(async () => undefined) };
  const loader = {
    main: vi.fn(async () => {
      if (opts.mainThrows) throw opts.mainThrows;
      return opts.chipName ?? 'ESP32-S3';
    }),
    writeFlash: vi.fn(opts.writeFlashImpl ?? (async () => undefined)),
  };
  const factory: LoaderFactory = vi.fn(async () => ({ loader, transport })) as unknown as LoaderFactory;
  return { factory, loader, transport };
}

function noopCallbacks(): InstallCallbacks {
  return {
    onPhaseChange: vi.fn(),
    onProgress:    vi.fn(),
    onLog:         vi.fn(),
    onDeviceFound: vi.fn(),
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('chipMatchesDistribution', () => {
  it('matches exact lowercased name', () => {
    expect(chipMatchesDistribution('ESP32', distribution)).toBe(true);
  });
  it('matches via prefix on dash-normalized name', () => {
    expect(chipMatchesDistribution('ESP32-S3', distribution)).toBe(true);
  });
  it('rejects non-matching chip family', () => {
    expect(chipMatchesDistribution('STM32', distribution)).toBe(false);
  });
});

describe('buildDisplayName', () => {
  it('returns chip name alone when no port info', () => {
    expect(buildDisplayName('ESP32', undefined)).toBe('ESP32');
  });
  it('appends USB vid:pid when present', () => {
    expect(buildDisplayName('ESP32', { usbVendorId: 0x10c4, usbProductId: 0xea60 }))
      .toBe('ESP32 (USB 10c4:ea60)');
  });
});

describe('ERROR_CATALOG', () => {
  it('declares the expected codes', () => {
    const expected = [
      'BOOTLOADER_SYNC_FAILED', 'CHIP_MISMATCH', 'PORT_OPEN_FAILED',
      'WRITE_FAILED', 'VERIFY_FAILED', 'WEB_SERIAL_UNSUPPORTED',
      'PERMISSION_DENIED', 'BINARY_NOT_BUILT',
    ];
    for (const code of expected) {
      expect(ERROR_CATALOG[code]).toBeDefined();
      expect(ERROR_CATALOG[code].message).toBeTruthy();
      expect(ERROR_CATALOG[code].guidance).toBeTruthy();
    }
  });
});

// ─── findDevice ───────────────────────────────────────────────────────────────

describe('WebSerialTransport.findDevice', () => {
  it('returns DeviceMetadata on a matching chip', async () => {
    const { factory, loader, transport } = fakeLoaderFactory({ chipName: 'ESP32-S3' });
    const t = new WebSerialTransport({
      serial: fakeSerial(fakePort({ usbVendorId: 0x10c4, usbProductId: 0xea60 })) as any,
      loaderFactory: factory,
      fetchImpl: fakeFetch(),
    });
    const dev = await t.findDevice(distribution);
    expect(dev.transportKind).toBe('serial-port');
    expect(dev.displayName).toBe('ESP32-S3 (USB 10c4:ea60)');
    expect(loader.main).toHaveBeenCalled();
    expect(transport.disconnect).not.toHaveBeenCalled();
  });

  it('throws PERMISSION_DENIED when user dismisses port picker', async () => {
    const t = new WebSerialTransport({
      serial: { requestPort: vi.fn(async () => { throw new Error('user dismissed'); }) } as any,
      loaderFactory: fakeLoaderFactory({}).factory,
      fetchImpl: fakeFetch(),
    });
    await expect(t.findDevice(distribution)).rejects.toMatchObject({ __installerErrorCode: 'PERMISSION_DENIED' });
  });

  it('throws BOOTLOADER_SYNC_FAILED and disconnects when main() throws', async () => {
    const { factory, transport } = fakeLoaderFactory({ mainThrows: new Error('sync timeout') });
    const t = new WebSerialTransport({
      serial: fakeSerial(fakePort()) as any,
      loaderFactory: factory,
      fetchImpl: fakeFetch(),
    });
    await expect(t.findDevice(distribution)).rejects.toMatchObject({ __installerErrorCode: 'BOOTLOADER_SYNC_FAILED' });
    expect(transport.disconnect).toHaveBeenCalled();
  });

  it('throws CHIP_MISMATCH when detected chip is not in boardIds', async () => {
    const { factory, transport } = fakeLoaderFactory({ chipName: 'STM32F4' });
    const t = new WebSerialTransport({
      serial: fakeSerial(fakePort()) as any,
      loaderFactory: factory,
      fetchImpl: fakeFetch(),
    });
    await expect(t.findDevice(distribution)).rejects.toMatchObject({ __installerErrorCode: 'CHIP_MISMATCH' });
    expect(transport.disconnect).toHaveBeenCalled();
  });
});

// ─── install ──────────────────────────────────────────────────────────────────

describe('WebSerialTransport.install', () => {
  let t: WebSerialTransport;
  let loader: any;
  let transport: any;
  let fetchImpl: ReturnType<typeof fakeFetch>;

  beforeEach(async () => {
    const fac = fakeLoaderFactory({ chipName: 'ESP32' });
    loader = fac.loader;
    transport = fac.transport;
    fetchImpl = fakeFetch();
    t = new WebSerialTransport({
      serial: fakeSerial(fakePort()) as any,
      loaderFactory: fac.factory,
      fetchImpl,
    });
    // Prime `handle` by running findDevice.
    await t.findDevice(distribution);
  });

  it('fetches each binary and calls writeFlash', async () => {
    const cb = noopCallbacks();
    await t.install(distribution, { transportKind: 'serial-port', displayName: 'd' }, cb, new AbortController().signal);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(loader.writeFlash).toHaveBeenCalledTimes(1);
    expect(transport.disconnect).toHaveBeenCalled();
    const phases = (cb.onPhaseChange as any).mock.calls.map((c: any[]) => c[0]);
    expect(phases).toContain('installing');
    expect(phases).toContain('verifying');
  });

  it('throws BINARY_NOT_BUILT when fetch returns non-ok', async () => {
    const fac = fakeLoaderFactory({ chipName: 'ESP32' });
    const t2 = new WebSerialTransport({
      serial: fakeSerial(fakePort()) as any,
      loaderFactory: fac.factory,
      fetchImpl: vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }) as any),
    });
    await t2.findDevice(distribution);
    await expect(
      t2.install(distribution, { transportKind: 'serial-port', displayName: 'd' }, noopCallbacks(), new AbortController().signal),
    ).rejects.toMatchObject({ __installerErrorCode: 'BINARY_NOT_BUILT' });
  });

  it('translates writeFlash progress to onProgress', async () => {
    const cb = noopCallbacks();
    loader.writeFlash.mockImplementationOnce(async (o: any) => {
      o.reportProgress(0, 50, 100);
      o.reportProgress(0, 100, 100);
      o.reportProgress(1, 50, 100);
    });
    await t.install(distribution, { transportKind: 'serial-port', displayName: 'd' }, cb, new AbortController().signal);
    const calls = (cb.onProgress as any).mock.calls.map((c: any[]) => c[0]);
    // last reported value before completion sweep is from fileIndex 1
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((p: number) => p >= 0 && p <= 1)).toBe(true);
    expect(calls[calls.length - 1]).toBe(1); // final onProgress(1) after writeFlash
  });

  it('honors abort signal mid-fetch', async () => {
    const fac = fakeLoaderFactory({ chipName: 'ESP32' });
    const ac = new AbortController();
    let firstFetched = false;
    const fImpl = vi.fn(async () => {
      if (!firstFetched) {
        firstFetched = true;
        ac.abort();
      }
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4), status: 200 } as unknown as Response;
    });
    const t2 = new WebSerialTransport({
      serial: fakeSerial(fakePort()) as any,
      loaderFactory: fac.factory,
      fetchImpl: fImpl,
    });
    await t2.findDevice(distribution);
    await expect(
      t2.install(distribution, { transportKind: 'serial-port', displayName: 'd' }, noopCallbacks(), ac.signal),
    ).rejects.toThrow(ERR_INSTALL_CANCELLED);
  });

  it('throws WRITE_FAILED when writeFlash explodes', async () => {
    loader.writeFlash.mockRejectedValueOnce(new Error('USB hiccup'));
    await expect(
      t.install(distribution, { transportKind: 'serial-port', displayName: 'd' }, noopCallbacks(), new AbortController().signal),
    ).rejects.toMatchObject({ __installerErrorCode: 'WRITE_FAILED' });
    expect(transport.disconnect).toHaveBeenCalled();
  });
});
