import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../core/event-bus';
import { ProgramConfigService } from '../core/program-config';
import type { InboundMessage } from '../core/types';
import type { CameraFrame } from './camera';
import type { InferenceBackend, Detection } from './vision-inference';
import { createVisionInferenceHandler, DEFAULT_VISION_MODEL } from './vision-inference';
import os from 'os';
import path from 'path';
import fs from 'fs';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return { type: 'infer-frame', data: '', ackId: 'ack-1', deviceUuid: 'dev-123', ...overrides };
}

function makeTmpConfig(config: object = {}): ProgramConfigService {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-vision-test-'));
  const file = path.join(dir, 'program-config.json');
  fs.writeFileSync(file, JSON.stringify(config));
  return new ProgramConfigService(file);
}

const MOCK_FRAME: CameraFrame = {
  mimeType:   'image/jpeg',
  encoding:   'base64',
  frame:      'abc123',
  capturedAt: '2026-05-14T00:00:00.000Z',
  width:      320,
  height:     240,
};

const MOCK_DETECTIONS: Detection[] = [
  { label: 'cat', score: 0.92, box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
];

// Successful backend stub
const successBackend: InferenceBackend = {
  name: 'test-success',
  infer: vi.fn().mockResolvedValue(MOCK_DETECTIONS),
};

// Error-throwing backend stub
const errorBackend: InferenceBackend = {
  name: 'test-error',
  infer: vi.fn().mockRejectedValue(new Error('GPU OOM')),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createVisionInferenceHandler', () => {
  let bus: EventBus;
  let sent: unknown[];
  const capture = vi.fn().mockResolvedValue(MOCK_FRAME);

  beforeEach(() => {
    bus  = new EventBus();
    sent = [];
    bus.on('network:send', (p) => sent.push(p.payload));
    vi.mocked(successBackend.infer).mockClear();
    vi.mocked(errorBackend.infer).mockClear();
    capture.mockClear();
  });

  it('emits vision-inference with status "unavailable" when no backend is provided', async () => {
    const configSvc = makeTmpConfig();
    const handler   = createVisionInferenceHandler(bus, configSvc, capture, null);

    await handler(makeMsg());

    expect(sent).toHaveLength(1);
    const payload = sent[0] as Record<string, unknown>;
    expect(payload['type']).toBe('vision-inference');
    expect(payload['deviceUuid']).toBe('dev-123');
    const data = JSON.parse(payload['data'] as string) as Record<string, unknown>;
    expect(data['status']).toBe('unavailable');
    expect(data['detections']).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it('calls backend.infer() with frame, mimeType, and modelId from config', async () => {
    const configSvc = makeTmpConfig({ vision: { modelId: 'Xenova/yolos-tiny' } });
    const handler   = createVisionInferenceHandler(bus, configSvc, capture, successBackend);

    await handler(makeMsg());

    expect(capture).toHaveBeenCalledOnce();
    expect(successBackend.infer).toHaveBeenCalledWith(
      MOCK_FRAME.frame,
      MOCK_FRAME.mimeType,
      'Xenova/yolos-tiny',
    );
  });

  it('falls back to DEFAULT_VISION_MODEL when no modelId in config', async () => {
    const configSvc = makeTmpConfig({});
    const handler   = createVisionInferenceHandler(bus, configSvc, capture, successBackend);

    await handler(makeMsg());

    expect(successBackend.infer).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      DEFAULT_VISION_MODEL,
    );
  });

  it('emits vision-inference with status "ok" and detections on success', async () => {
    const configSvc = makeTmpConfig();
    const handler   = createVisionInferenceHandler(bus, configSvc, capture, successBackend);

    await handler(makeMsg({ deviceUuid: 'dev-456' }));

    expect(sent).toHaveLength(1);
    const payload = sent[0] as Record<string, unknown>;
    expect(payload['type']).toBe('vision-inference');
    expect(payload['deviceUuid']).toBe('dev-456');
    const data = JSON.parse(payload['data'] as string) as Record<string, unknown>;
    expect(data['status']).toBe('ok');
    expect(data['detections']).toEqual(MOCK_DETECTIONS);
    expect(typeof data['latencyMs']).toBe('number');
    expect(typeof data['inferredAt']).toBe('string');
    expect(data['modelId']).toBe(DEFAULT_VISION_MODEL);
  });

  it('emits vision-inference with status "error" when backend throws', async () => {
    const configSvc = makeTmpConfig();
    const handler   = createVisionInferenceHandler(bus, configSvc, capture, errorBackend);

    await handler(makeMsg());

    expect(sent).toHaveLength(1);
    const data = JSON.parse((sent[0] as any)['data']) as Record<string, unknown>;
    expect(data['status']).toBe('error');
    expect(data['error']).toContain('GPU OOM');
    expect(data['detections']).toEqual([]);
  });

  it('emits vision-inference with status "error" when camera capture throws', async () => {
    const failCapture = vi.fn().mockRejectedValue(new Error('camera not found'));
    const configSvc  = makeTmpConfig();
    const handler    = createVisionInferenceHandler(bus, configSvc, failCapture, successBackend);

    await handler(makeMsg());

    expect(sent).toHaveLength(1);
    const data = JSON.parse((sent[0] as any)['data']) as Record<string, unknown>;
    expect(data['status']).toBe('error');
    expect((data['error'] as string)).toContain('camera not found');
    // Backend should not be called if capture fails
    expect(successBackend.infer).not.toHaveBeenCalled();
  });

  it('data field is always a JSON string (wire contract)', async () => {
    const configSvc = makeTmpConfig();
    const handler   = createVisionInferenceHandler(bus, configSvc, capture, null);

    await handler(makeMsg());

    const payload = sent[0] as Record<string, unknown>;
    expect(typeof payload['data']).toBe('string');
    // Must parse without throwing
    expect(() => JSON.parse(payload['data'] as string)).not.toThrow();
  });

  it('handler resolves without throwing even when backend fails', async () => {
    const configSvc = makeTmpConfig();
    const handler   = createVisionInferenceHandler(bus, configSvc, capture, errorBackend);

    await expect(handler(makeMsg())).resolves.toBeUndefined();
  });

  it('handler resolves without throwing when no backend is set', async () => {
    const configSvc = makeTmpConfig();
    const handler   = createVisionInferenceHandler(bus, configSvc, capture, null);

    await expect(handler(makeMsg())).resolves.toBeUndefined();
  });
});
