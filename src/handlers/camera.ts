import type { EventBus } from '../core/event-bus';
import type { MessageHandler } from './registry';
import { makeEnvelope } from '../core/wire';
import fs from 'fs';

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#101820"/><path d="M272 140h96l20 28h44v116H208V168h44z" fill="#234"/><circle cx="320" cy="226" r="52" fill="#5fd3ff"/><circle cx="320" cy="226" r="30" fill="#101820"/><text x="320" y="326" text-anchor="middle" fill="#cde" font-family="monospace" font-size="18">orobot camera</text></svg>`;

export type CameraFrame = {
  mimeType: string;
  encoding: 'base64';
  frame: string;
  capturedAt: string;
  width?: number;
  height?: number;
};

export type CameraCapture = () => Promise<CameraFrame>;

function inferMimeType(pathname: string): string {
  const lower = pathname.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

export async function captureCameraFrame(): Promise<CameraFrame> {
  const framePath = process.env.OROBOT_CAMERA_FRAME_PATH;
  if (framePath) {
    const frame = await fs.promises.readFile(framePath);
    return {
      mimeType: inferMimeType(framePath),
      encoding: 'base64',
      frame: frame.toString('base64'),
      capturedAt: new Date().toISOString(),
    };
  }

  return {
    mimeType: 'image/svg+xml',
    encoding: 'base64',
    frame: Buffer.from(FALLBACK_SVG, 'utf-8').toString('base64'),
    capturedAt: new Date().toISOString(),
    width: 640,
    height: 360,
  };
}

export function createCameraHandler(
  bus: EventBus,
  capture: CameraCapture = captureCameraFrame,
): MessageHandler {
  return async (msg) => {
    const frame = await capture();
    bus.emit('network:send', {
      payload: makeEnvelope('camera-frame', {
        deviceUuid: msg.deviceUuid,
        data: frame,
      }),
    });
  };
}
