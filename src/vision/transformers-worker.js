/**
 * transformers.js inference worker.
 *
 * Spawned as a child process by TransformersJsBackend. Reads a single
 * { frame, mimeType, modelId } message via IPC, runs object detection using
 * @xenova/transformers, writes detection JSON to stdout, then exits.
 *
 * This file intentionally lives as .js (not .ts) so it can be fork()ed at
 * runtime without a TypeScript compilation step. It is excluded from the
 * main esbuild bundle and executed directly by node.
 *
 * Requires: npm install @xenova/transformers
 * Tested with: @xenova/transformers@2.x (ONNX Runtime web backend)
 */

'use strict';

process.on('message', async ({ frame, mimeType, modelId }) => {
  try {
    // Dynamic import — avoids hard dep at startup (optional installation).
    const { pipeline, env, RawImage } = await import('@xenova/transformers');

    // Use local cache dir to avoid re-downloading on every inference call.
    env.cacheDir = process.env.OROBOT_VISION_CACHE_DIR ?? '/tmp/orobot-vision-cache';
    // Disable model caching telemetry.
    env.useFSCache = true;

    const detector = await pipeline('object-detection', modelId, {
      quantized: true,   // Use int8-quantised model for Pi 4 speed.
    });

    // Decode base64 frame to a RawImage the pipeline expects.
    const imageBuffer = Buffer.from(frame, 'base64');
    const image = await RawImage.fromBlob(new Blob([imageBuffer], { type: mimeType }));

    const raw = await detector(image, { threshold: 0.5, percentage: true });

    // Normalise output to our Detection schema.
    const detections = (raw ?? []).map((item) => ({
      label: item.label,
      score: item.score,
      box: {
        x:      item.box.xmin,
        y:      item.box.ymin,
        width:  item.box.xmax - item.box.xmin,
        height: item.box.ymax - item.box.ymin,
      },
    }));

    process.stdout.write(JSON.stringify(detections));
    process.exit(0);
  } catch (err) {
    process.stderr.write(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
});
