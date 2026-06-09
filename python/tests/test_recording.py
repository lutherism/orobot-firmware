"""Tests for the recording session and on-disk episode format."""

from __future__ import annotations

import json

import pytest

from orobot import OrobotClient


def _read_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def test_record_writes_meta_and_frames(tmp_path):
    client = OrobotClient(api_key="k")
    out = tmp_path / "ep0"

    with client.record("robot-1", output_dir=out, fps=10.0, joint_names=["j1", "j2"]) as s:
        s.add_frame({"j1": 0.1, "j2": 0.2}, t=0.0)
        s.add_frame({"j1": 0.15, "j2": 0.25}, t=0.1, action={"j1": 0.2})

    meta = json.loads((out / "meta.json").read_text())
    assert meta["format"] == "orobot-episode/v0"
    assert meta["robot_uuid"] == "robot-1"
    assert meta["fps"] == 10.0
    assert meta["joint_names"] == ["j1", "j2"]
    assert meta["num_frames"] == 2

    frames = _read_jsonl(out / "frames.jsonl")
    assert len(frames) == 2
    assert frames[0]["t"] == 0.0
    assert frames[0]["joints"] == {"j1": 0.1, "j2": 0.2}
    assert frames[1]["action"] == {"j1": 0.2}


def test_frames_flushed_incrementally(tmp_path):
    client = OrobotClient(api_key="k")
    out = tmp_path / "ep1"
    with client.record("robot-1", output_dir=out) as s:
        s.add_frame({"j1": 0.0}, t=0.0)
        # Frame should be on disk before the context exits (append-only flush).
        partial = _read_jsonl(out / "frames.jsonl")
        assert len(partial) == 1


def test_add_frame_outside_context_raises(tmp_path):
    client = OrobotClient(api_key="k")
    session = client.record("robot-1", output_dir=tmp_path / "ep2")
    with pytest.raises(RuntimeError):
        session.add_frame({"j1": 0.0})


def test_re_recording_truncates(tmp_path):
    client = OrobotClient(api_key="k")
    out = tmp_path / "ep3"
    with client.record("robot-1", output_dir=out) as s:
        s.add_frame({"j1": 0.0}, t=0.0)
        s.add_frame({"j1": 1.0}, t=0.1)
    with client.record("robot-1", output_dir=out) as s:
        s.add_frame({"j1": 2.0}, t=0.0)
    frames = _read_jsonl(out / "frames.jsonl")
    assert len(frames) == 1
    assert frames[0]["joints"] == {"j1": 2.0}


def test_stop_ends_wait(tmp_path):
    client = OrobotClient(api_key="k")
    out = tmp_path / "ep4"
    with client.record("robot-1", output_dir=out) as s:
        s.stop()
        s.wait_for_stop(poll_interval=0.01)  # returns immediately
