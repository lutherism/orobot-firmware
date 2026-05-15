import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CameraStreamService, simFrameSource, type FetchFn, type SleepFn, type FrameSource } from './stream-service.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEVICE_UUID   = 'dev-test-uuid';
const DEVICE_SECRET = 'test-secret-abc';
const GATEWAY_BASE  = 'http://localhost:8080';

/** A mock fetch response helper. */
function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok:     status >= 200 && status < 300,
    status,
    json:   () => Promise.resolve(body),
    text:   () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Session response fixture. */
function sessionResponse(expiresInMs = 30 * 60 * 1000): Response {
  return mockResponse(200, {
    sessionToken: 'tok-abc',
    expiresAt:    Date.now() + expiresInMs,
  });
}

/** Static test frame (2 bytes — not a real JPEG, but sufficient for unit tests). */
const TEST_FRAME = Buffer.from([0xff, 0xd8]);
const frameSource: FrameSource = () => Promise.resolve(TEST_FRAME);

/** A sleep stub that resolves immediately. */
const noopSleep: SleepFn = () => Promise.resolve();

/** A sleep stub that captures durations for assertions. */
function recordingSleep(durations: number[]): SleepFn {
  return (ms) => {
    durations.push(ms);
    return Promise.resolve();
  };
}

/**
 * Build a CameraStreamService wired to stop after `maxFrames` successful pushes.
 * Returns { service, fetchCalls } so tests can inspect request details.
 */
function makeService(opts: {
  maxPushes?:     number;
  fetchResponses: Array<() => Response>;
  sleepFn?:       SleepFn;
}): { service: CameraStreamService; fetchCalls: Array<{ url: string; init?: RequestInit }> } {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  let   callIndex = 0;
  let   pushCount = 0;
  const maxPushes = opts.maxPushes ?? 1;

  const fetchFn: FetchFn = (url, init) => {
    fetchCalls.push({ url: String(url), init });
    const resp = opts.fetchResponses[callIndex]?.() ?? mockResponse(204);
    callIndex++;
    // Stop the service after maxPushes successful pushes.
    if (String(url).includes('/stream/push') && resp.ok) {
      pushCount++;
      if (pushCount >= maxPushes) {
        service.stop();
      }
    }
    return Promise.resolve(resp);
  };

  const service = new CameraStreamService({
    deviceUuid:      DEVICE_UUID,
    deviceSecret:    DEVICE_SECRET,
    gatewayHttpBase: GATEWAY_BASE,
    frameSource,
    frameIntervalMs: 0,
    fetchFn,
    sleepFn: opts.sleepFn ?? noopSleep,
  });

  return { service, fetchCalls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('simFrameSource', () => {
  it('returns a non-empty Buffer', async () => {
    const frame = await simFrameSource();
    expect(Buffer.isBuffer(frame)).toBe(true);
    expect(frame.length).toBeGreaterThan(0);
  });

  it('starts with JPEG magic bytes 0xFF 0xD8', async () => {
    const frame = await simFrameSource();
    expect(frame[0]).toBe(0xff);
    expect(frame[1]).toBe(0xd8);
  });
});

describe('CameraStreamService', () => {
  describe('happy path', () => {
    it('calls POST /session then POST /stream/push', async () => {
      const { service, fetchCalls } = makeService({
        fetchResponses: [
          () => sessionResponse(),           // session
          () => mockResponse(204),           // push
        ],
      });

      await service.start();

      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0]!.url).toBe(`${GATEWAY_BASE}/api/device/${DEVICE_UUID}/session`);
      expect(fetchCalls[1]!.url).toBe(`${GATEWAY_BASE}/api/device/${DEVICE_UUID}/stream/push`);
    });

    it('sends POST body to /session with device secret', async () => {
      const { service, fetchCalls } = makeService({
        fetchResponses: [() => sessionResponse(), () => mockResponse(204)],
      });
      await service.start();

      const sessionCall = fetchCalls[0]!;
      expect(sessionCall.init?.method).toBe('POST');
      const body = JSON.parse(sessionCall.init?.body as string) as { secret: string };
      expect(body.secret).toBe(DEVICE_SECRET);
    });

    it('sends Authorization: Bearer <token> on push', async () => {
      const { service, fetchCalls } = makeService({
        fetchResponses: [() => sessionResponse(), () => mockResponse(204)],
      });
      await service.start();

      const pushCall = fetchCalls[1]!;
      expect((pushCall.init?.headers as Record<string, string>)['Authorization'])
        .toBe('Bearer tok-abc');
    });

    it('sends the frame buffer in the push body', async () => {
      const { service, fetchCalls } = makeService({
        fetchResponses: [() => sessionResponse(), () => mockResponse(204)],
      });
      await service.start();

      const pushCall = fetchCalls[1]!;
      expect(pushCall.init?.body).toEqual(TEST_FRAME);
    });

    it('reuses the same session token for multiple pushes without re-fetching', async () => {
      const { service, fetchCalls } = makeService({
        maxPushes: 3,
        fetchResponses: [
          () => sessionResponse(60 * 60 * 1000), // 1 hour TTL
          () => mockResponse(204),
          () => mockResponse(204),
          () => mockResponse(204),
        ],
      });
      await service.start();

      // Only 1 session fetch for 3 pushes.
      const sessionCalls = fetchCalls.filter(c => c.url.includes('/session'));
      expect(sessionCalls).toHaveLength(1);
    });
  });

  describe('token expiry and refresh', () => {
    it('re-fetches token when it is within 5 minutes of expiry', async () => {
      // Token that expires in 4 min (< TOKEN_REFRESH_BEFORE_MS of 5 min)
      const nearlyExpired = mockResponse(200, {
        sessionToken: 'tok-stale',
        expiresAt:    Date.now() + 4 * 60 * 1000,
      });
      const fresh = mockResponse(200, {
        sessionToken: 'tok-fresh',
        expiresAt:    Date.now() + 60 * 60 * 1000,
      });

      let sessionCallCount = 0;
      const fetchCalls: string[] = [];
      let pushCount = 0;
      let svc!: CameraStreamService;

      const fetchFn: FetchFn = (url) => {
        fetchCalls.push(String(url));
        if (String(url).includes('/session')) {
          sessionCallCount++;
          return Promise.resolve(sessionCallCount === 1 ? nearlyExpired : fresh);
        }
        pushCount++;
        if (pushCount >= 2) svc.stop();
        return Promise.resolve(mockResponse(204));
      };

      svc = new CameraStreamService({
        deviceUuid: DEVICE_UUID, deviceSecret: DEVICE_SECRET,
        gatewayHttpBase: GATEWAY_BASE,
        frameSource, frameIntervalMs: 0,
        fetchFn, sleepFn: noopSleep,
      });

      await svc.start();

      // Second iteration should re-fetch the token because first was near-expiry.
      expect(sessionCallCount).toBeGreaterThanOrEqual(2);
    });

    it('re-fetches token after a 401 push rejection', async () => {
      let sessionCalls = 0;
      let pushCalls    = 0;
      let svc!: CameraStreamService;

      const fetchFn: FetchFn = (url) => {
        if (String(url).includes('/session')) {
          sessionCalls++;
          return Promise.resolve(mockResponse(200, {
            sessionToken: `tok-${sessionCalls}`,
            expiresAt:    Date.now() + 60 * 60 * 1000,
          }));
        }
        pushCalls++;
        if (pushCalls === 1) return Promise.resolve(mockResponse(401)); // first push rejected
        svc.stop();
        return Promise.resolve(mockResponse(204));                       // second push ok
      };

      svc = new CameraStreamService({
        deviceUuid: DEVICE_UUID, deviceSecret: DEVICE_SECRET,
        gatewayHttpBase: GATEWAY_BASE,
        frameSource, frameIntervalMs: 0,
        fetchFn, sleepFn: noopSleep,
      });

      await svc.start();

      // Should have re-fetched token after 401.
      expect(sessionCalls).toBe(2);
      expect(pushCalls).toBe(2);
    });
  });

  describe('backoff on errors', () => {
    it('backs off exponentially when session fetch fails, then succeeds', async () => {
      const sleepDurations: number[] = [];
      let attempts = 0;
      let svc!: CameraStreamService;

      const fetchFn: FetchFn = (url) => {
        if (String(url).includes('/session')) {
          attempts++;
          if (attempts <= 2) return Promise.reject(new Error('network error'));
          return Promise.resolve(mockResponse(200, {
            sessionToken: 'tok-ok', expiresAt: Date.now() + 60 * 60 * 1000,
          }));
        }
        svc.stop();
        return Promise.resolve(mockResponse(204));
      };

      svc = new CameraStreamService({
        deviceUuid: DEVICE_UUID, deviceSecret: DEVICE_SECRET,
        gatewayHttpBase: GATEWAY_BASE,
        frameSource, frameIntervalMs: 0,
        fetchFn, sleepFn: recordingSleep(sleepDurations),
      });

      await svc.start();

      // First error → sleep 2000; second error → sleep 4000; success → reset
      expect(sleepDurations.length).toBeGreaterThanOrEqual(2);
      expect(sleepDurations[0]).toBe(2_000);
      expect(sleepDurations[1]).toBe(4_000);
    });

    it('caps backoff at 60 seconds', async () => {
      const sleepDurations: number[] = [];
      let callCount = 0;
      let svc!: CameraStreamService;

      const fetchFn: FetchFn = (url) => {
        callCount++;
        // Keep failing until we've seen enough backoffs to reach the cap.
        if (callCount <= 10) return Promise.reject(new Error('fail'));
        if (String(url).includes('/session')) {
          return Promise.resolve(mockResponse(200, {
            sessionToken: 'tok-ok', expiresAt: Date.now() + 60 * 60 * 1000,
          }));
        }
        svc.stop();
        return Promise.resolve(mockResponse(204));
      };

      svc = new CameraStreamService({
        deviceUuid: DEVICE_UUID, deviceSecret: DEVICE_SECRET,
        gatewayHttpBase: GATEWAY_BASE,
        frameSource, frameIntervalMs: 0,
        fetchFn, sleepFn: recordingSleep(sleepDurations),
      });

      await svc.start();

      // No sleep duration should exceed MAX_BACKOFF_MS (60 000 ms).
      const maxSeen = Math.max(...sleepDurations);
      expect(maxSeen).toBeLessThanOrEqual(60_000);
    });
  });

  describe('stop()', () => {
    it('halts the loop so start() resolves', async () => {
      let svc!: CameraStreamService;
      let sessionFetched = false;

      const fetchFn: FetchFn = (url) => {
        if (String(url).includes('/session')) {
          sessionFetched = true;
          svc.stop(); // stop immediately after getting the token
          return Promise.resolve(mockResponse(200, {
            sessionToken: 'tok-stop', expiresAt: Date.now() + 60_000,
          }));
        }
        // Push should never be reached because stop() was called before the push loop.
        throw new Error('unexpected push call after stop');
      };

      svc = new CameraStreamService({
        deviceUuid: DEVICE_UUID, deviceSecret: DEVICE_SECRET,
        gatewayHttpBase: GATEWAY_BASE,
        frameSource, frameIntervalMs: 0,
        fetchFn, sleepFn: noopSleep,
      });

      await svc.start();
      expect(sessionFetched).toBe(true);
    });

    it('calling stop() before start() returns immediately', async () => {
      const { service } = makeService({ fetchResponses: [] });
      service.stop();
      // start() should return immediately since running is false.
      const p = service.start();
      await expect(p).resolves.toBeUndefined();
    });
  });
});
