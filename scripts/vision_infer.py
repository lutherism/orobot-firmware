#!/usr/bin/env python3
"""
On-device vision inference helper for orobot-firmware.

Reads a JSON request from stdin:
  { "frame": "<base64>", "mimeType": "image/jpeg", "modelId": "Xenova/detr-resnet-50" }

Writes a JSON array of detections to stdout:
  [{ "label": "cat", "score": 0.92, "box": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4 } }]

Backend selection (in priority order):
  1. CUDA via PyTorch (Jetson Orin / AGX — export OROBOT_VISION_DEVICE=cuda)
  2. TensorRT (Jetson — needs tensorrt package; export OROBOT_VISION_DEVICE=tensorrt)
  3. CPU ONNX Runtime (Raspberry Pi 4 — default)

Model source: HuggingFace Hub (auto-cached to OROBOT_VISION_CACHE_DIR, default /tmp/orobot-vision-cache).
The ONNX variant is fetched automatically for ONNX Runtime.

Dependencies (install on device before enabling):
  pip3 install optimum[onnxruntime] transformers pillow  # Pi 4
  pip3 install optimum[onnxruntime-gpu] transformers pillow  # Jetson (CPU fallback still works)

Exit codes:
  0 — success, stdout contains JSON detections
  1 — inference failed, stderr contains error message
  2 — dependency missing (optimum / transformers / pillow not installed)
"""

import sys
import json
import base64
import io
import os
import time

CACHE_DIR = os.environ.get('OROBOT_VISION_CACHE_DIR', '/tmp/orobot-vision-cache')
DEVICE    = os.environ.get('OROBOT_VISION_DEVICE', 'cpu')  # 'cpu' | 'cuda' | 'tensorrt'

def eprint(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def load_dependencies():
    try:
        from PIL import Image
        return Image
    except ImportError:
        eprint('Pillow not found. Install: pip3 install pillow')
        sys.exit(2)


def run_onnx(image, model_id: str) -> list[dict]:
    """ONNX Runtime path — works on Raspberry Pi 4 (CPU only)."""
    try:
        from optimum.onnxruntime import ORTModelForObjectDetection
        from transformers import AutoFeatureExtractor
    except ImportError:
        eprint('optimum[onnxruntime] not found. Install: pip3 install optimum[onnxruntime] transformers')
        sys.exit(2)

    extractor = AutoFeatureExtractor.from_pretrained(model_id, cache_dir=CACHE_DIR)
    model     = ORTModelForObjectDetection.from_pretrained(
        model_id, export=True, cache_dir=CACHE_DIR,
    )

    inputs  = extractor(images=image, return_tensors='pt')
    outputs = model(**inputs)

    target_sizes = [(image.height, image.width)]
    results = extractor.post_process_object_detection(
        outputs, threshold=0.5, target_sizes=target_sizes,
    )[0]

    detections = []
    for score, label, box in zip(
        results['scores'].tolist(),
        results['labels'].tolist(),
        results['boxes'].tolist(),
    ):
        x1, y1, x2, y2 = box
        detections.append({
            'label': model.config.id2label[label],
            'score': round(score, 4),
            'box': {
                'x':      round(x1 / image.width,  4),
                'y':      round(y1 / image.height, 4),
                'width':  round((x2 - x1) / image.width,  4),
                'height': round((y2 - y1) / image.height, 4),
            },
        })
    return detections


def run_pytorch(image, model_id: str, device: str) -> list[dict]:
    """PyTorch path — full-precision or CUDA for Jetson."""
    try:
        import torch
        from transformers import pipeline as hf_pipeline
    except ImportError:
        eprint('torch/transformers not found. Install: pip3 install torch transformers')
        sys.exit(2)

    torch_device = 'cuda' if device == 'cuda' and torch.cuda.is_available() else 'cpu'
    detector = hf_pipeline(
        'object-detection',
        model=model_id,
        device=torch_device,
        model_kwargs={'cache_dir': CACHE_DIR},
    )
    results = detector(image, threshold=0.5)
    detections = []
    for item in results:
        b = item['box']
        detections.append({
            'label': item['label'],
            'score': round(item['score'], 4),
            'box': {
                'x':      round(b['xmin'] / image.width,  4),
                'y':      round(b['ymin'] / image.height, 4),
                'width':  round((b['xmax'] - b['xmin']) / image.width,  4),
                'height': round((b['ymax'] - b['ymin']) / image.height, 4),
            },
        })
    return detections


def main() -> None:
    Image = load_dependencies()

    try:
        request = json.load(sys.stdin)
        frame    = request['frame']
        mime     = request.get('mimeType', 'image/jpeg')
        model_id = request.get('modelId', 'Xenova/detr-resnet-50')
    except (json.JSONDecodeError, KeyError) as exc:
        eprint(f'Bad request: {exc}')
        sys.exit(1)

    # Decode image
    try:
        image_bytes = base64.b64decode(frame)
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    except Exception as exc:
        eprint(f'Image decode error: {exc}')
        sys.exit(1)

    os.makedirs(CACHE_DIR, exist_ok=True)

    try:
        if DEVICE in ('cuda', 'tensorrt'):
            detections = run_pytorch(image, model_id, DEVICE)
        else:
            detections = run_onnx(image, model_id)
    except Exception as exc:
        eprint(f'Inference error: {exc}')
        sys.exit(1)

    print(json.dumps(detections), end='', flush=True)


if __name__ == '__main__':
    main()
