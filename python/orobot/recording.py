"""Recording session + on-disk episode format.

A ``RecordingSession`` is a context manager that captures a stream of frames —
each frame being a timestamped snapshot of joint state (and, later, camera
images) — and writes them to a self-describing directory on disk:

    output_dir/
      meta.json        # episode-level metadata (robot uuid, fps, joint names, ...)
      frames.jsonl     # one JSON object per captured frame, append-only

This on-disk shape is intentionally simple and format-agnostic. Converting it
to a Hugging Face ``LeRobotDataset`` (Parquet + MP4) is a separate, optional
step (``orobot.export``) so that recording works with zero heavy dependencies.

This 0.0.x release wires the container, the frame schema, and the file format.
The live joint-state source flows over the gateway ``/control`` WebSocket and is
populated by the platform-side recording pipeline (orobotio#3252); until that
lands, frames are appended explicitly via ``session.add_frame(...)`` (which is
exactly what the WS stream callback will call), so the format and the export
path can be exercised end to end today.
"""

from __future__ import annotations

import json
import signal
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Mapping


@dataclass
class Frame:
    """A single timestamped observation captured during a recording."""

    t: float  # seconds since episode start
    joints: dict[str, float]  # joint name -> position (radians)
    images: dict[str, str] = field(default_factory=dict)  # camera name -> file path
    action: dict[str, float] | None = None  # commanded joint targets, if any


@dataclass
class Episode:
    """In-memory + on-disk representation of one recorded episode."""

    output_dir: Path
    robot_uuid: str
    fps: float
    joint_names: list[str]
    frames: list[Frame] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)

    @property
    def meta_path(self) -> Path:
        return self.output_dir / "meta.json"

    @property
    def frames_path(self) -> Path:
        return self.output_dir / "frames.jsonl"

    def meta(self) -> dict[str, Any]:
        return {
            "format": "orobot-episode/v0",
            "robot_uuid": self.robot_uuid,
            "fps": self.fps,
            "joint_names": self.joint_names,
            "started_at": self.started_at,
            "num_frames": len(self.frames),
        }


class RecordingSession:
    """Context manager that records frames to ``output_dir`` as JSONL.

    Use as::

        with client.record(robot_uuid, output_dir="./ep0") as session:
            session.wait_for_stop()

    Frames are flushed to disk as they arrive (append-only JSONL), so a crash
    mid-episode still leaves a readable partial recording.
    """

    def __init__(self, episode: Episode):
        self.episode = episode
        self._fp = None
        self._stop_requested = False

    # -- lifecycle -----------------------------------------------------------
    def __enter__(self) -> "RecordingSession":
        self.episode.output_dir.mkdir(parents=True, exist_ok=True)
        # Truncate any prior frames so re-recording into the same dir is clean.
        self._fp = self.episode.frames_path.open("w", encoding="utf-8")
        self._write_meta()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if self._fp is not None:
                self._fp.flush()
                self._fp.close()
        finally:
            self._fp = None
            # Rewrite meta with the final frame count.
            self._write_meta()

    # -- capture -------------------------------------------------------------
    def add_frame(
        self,
        joints: Mapping[str, float],
        *,
        t: float | None = None,
        images: Mapping[str, str] | None = None,
        action: Mapping[str, float] | None = None,
    ) -> Frame:
        """Append one observation. Returns the stored ``Frame``.

        ``t`` defaults to seconds elapsed since the episode started. This is the
        sink the ``/control`` WebSocket joint-state callback will drive once the
        live-stream pipeline (orobotio#3252) lands.
        """
        if self._fp is None:
            raise RuntimeError("add_frame() called outside the recording context")
        frame = Frame(
            t=t if t is not None else (time.time() - self.episode.started_at),
            joints=dict(joints),
            images=dict(images or {}),
            action=dict(action) if action is not None else None,
        )
        self.episode.frames.append(frame)
        self._fp.write(json.dumps(asdict(frame)) + "\n")
        self._fp.flush()
        return frame

    # -- control -------------------------------------------------------------
    def wait_for_stop(self, *, poll_interval: float = 0.1) -> None:
        """Block until the user stops the session (Ctrl-C) or ``stop()`` is called.

        Installs a SIGINT handler so Ctrl-C in a notebook cell ends the episode
        cleanly instead of raising out of the ``with`` block.
        """
        previous = signal.getsignal(signal.SIGINT)

        def _handler(signum, frame):  # noqa: ARG001
            self._stop_requested = True

        signal.signal(signal.SIGINT, _handler)
        try:
            while not self._stop_requested:
                time.sleep(poll_interval)
        finally:
            signal.signal(signal.SIGINT, previous)

    def stop(self) -> None:
        self._stop_requested = True

    # -- internals -----------------------------------------------------------
    def _write_meta(self) -> None:
        self.episode.meta_path.write_text(
            json.dumps(self.episode.meta(), indent=2), encoding="utf-8"
        )
