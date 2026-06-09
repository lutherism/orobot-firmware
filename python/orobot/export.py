"""LeRobotDataset export (deferred — gated on orobotio#3252).

The export step converts on-disk orobot episodes (see ``orobot.recording``) into
a Hugging Face ``LeRobotDataset`` v3.0 (Parquet timeseries + MP4 video) and
optionally pushes to the Hub.

This is intentionally NOT implemented in the 0.0.x core for two reasons:

1. **Contract dependency.** The exact joint-timeseries / camera-frame schema is
   being finalized by the platform-side recording pipeline (orobotio#3252).
   Pinning a LeRobotDataset mapping before that lands would bake in a guess.

2. **Dependency weight.** A real export pulls in ``datasets``, ``pyarrow``, and
   ``lerobot`` (+ ffmpeg). Those live behind the ``orobot[lerobot]`` extra and
   are imported lazily so the core stays dependency-free.

When #3252 lands, implement ``to_lerobot_dataset`` here against the finalized
on-disk schema. Until then it raises ``NotImplementedError`` with a pointer.

Reference: https://huggingface.co/docs/lerobot/en/lerobot-dataset-v3
"""

from __future__ import annotations

from pathlib import Path

_TRACKING_ISSUE = "https://github.com/lutherism/orobotio/issues/3252"


def to_lerobot_dataset(
    data_dir: str | Path,
    *,
    repo_id: str,
    push_to_hub: bool = False,
) -> None:
    raise NotImplementedError(
        "LeRobotDataset export is not yet implemented. It is gated on the "
        "platform-side recording pipeline (orobotio#3252) finalizing the "
        "joint-timeseries / camera-frame contract. Track progress and the "
        f"planned schema at {_TRACKING_ISSUE}. "
        "Install the export extra with `pip install 'orobot[lerobot]'` once "
        "this is implemented."
    )
