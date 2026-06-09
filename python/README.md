# orobot — Python SDK

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://github.com/lutherism/orobot-firmware/tree/master/python/notebooks)

Python-native control and data-collection for [orobot.io](https://orobot.io). Connect to
a robot from a Jupyter/Colab notebook, read its state over the REST gateway, and record
teleoperation sessions to disk — the missing glue between orobot's browser-control layer
and the LeRobot / Hugging Face imitation-learning toolchain.

> **Status: 0.0.x (alpha).** This release ships the REST-backed core and the recording
> session + on-disk episode format. The `LeRobotDataset` export step (Parquet + MP4 +
> Hugging Face Hub push) is **deferred** pending the platform-side recording pipeline
> ([orobotio#3252](https://github.com/lutherism/orobotio/issues/3252)) — calling it today
> raises `NotImplementedError` with a tracking pointer. Tracked by
> [orobotio#3413](https://github.com/lutherism/orobotio/issues/3413).

## Install

```bash
pip install orobot                 # core: zero third-party deps, runs in a bare Colab kernel
pip install "orobot[lerobot]"      # adds the LeRobotDataset export deps (when implemented)
```

## Quickstart

```python
from orobot import OrobotClient

# Mint a key in the developer portal: POST /api/user/api-keys with scope robots:read
client = OrobotClient(api_key="ork_live_...")

# Read your robots (requires robots:read)
robots = client.list_robots()
robot_uuid = robots[0]["uuid"]

# Current joint positions (from the robot's state snapshot)
print(client.get_joint_state(robot_uuid))

# Record a teleoperation session — human drives via the browser, Ctrl-C stops
with client.record(robot_uuid, output_dir="./data/episode_0") as session:
    session.wait_for_stop()

# Export to a Hugging Face LeRobotDataset (deferred — see status note above)
client.export_lerobot_dataset("./data/", repo_id="myuser/my-robot-data")
```

## Auth

API keys authenticate via `Authorization: Bearer <plaintext>`. The gateway accepts them on
the robot/device REST routes used here:

| Method | Route | Scope |
|--------|-------|-------|
| `list_robots()` | `GET /api/robots` | `robots:read` |
| `get_robot()` / `get_joint_state()` | `GET /api/robot/:uuid` | public (key optional) |
| `list_devices()` | `GET /api/devices` | `devices:read` |

Point at a local gateway with `OrobotClient(api_key=..., base_url="http://localhost:8080")`.

## On-disk episode format (`orobot-episode/v0`)

```
output_dir/
  meta.json      # robot uuid, fps, joint names, frame count
  frames.jsonl   # one JSON object per frame: { t, joints, images, action }
```

Append-only and dependency-free, so a crash mid-episode still leaves a readable partial
recording. The `LeRobotDataset` exporter consumes this directory once #3252 finalizes the
joint-timeseries / camera-frame contract.

## Notebooks

- [`notebooks/01_record_episode.ipynb`](notebooks/01_record_episode.ipynb) — connect, record, save
- [`notebooks/02_export_to_hf_hub.ipynb`](notebooks/02_export_to_hf_hub.ipynb) — convert to LeRobotDataset, push (deferred)
- [`notebooks/03_train_act_policy.ipynb`](notebooks/03_train_act_policy.ipynb) — load dataset, train an ACT policy on Colab (deferred)

## Tests

```bash
cd python && python -m pytest -q
```

Core tests use a fake transport and a temp dir — no network, no hardware.
