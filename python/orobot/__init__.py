"""orobot — Python SDK for orobot.io.

Connect to an orobot device from a notebook, read robot/device metadata over the
REST gateway, and record teleoperation sessions to a local on-disk format that
can later be exported to a Hugging Face ``LeRobotDataset``.

Quickstart::

    from orobot import OrobotClient

    client = OrobotClient(api_key="ork_live_...")
    robots = client.list_robots()

    with client.record(robots[0]["uuid"], output_dir="./data/episode_0") as session:
        session.wait_for_stop()  # human teleops via the browser; Ctrl-C stops

This 0.0.x release ships the REST-backed core (auth, robot/device reads, the
recording session container and on-disk episode format). The
``LeRobotDataset`` export step (Parquet + MP4 + HF Hub push) is gated on the
platform-side recording pipeline (orobotio#3252) and currently raises
``NotImplementedError`` with a tracking pointer — see ``orobot.export``.
"""

from .client import OrobotClient
from .errors import OrobotError, AuthError, NotFoundError, ApiError
from .recording import RecordingSession, Episode

__all__ = [
    "OrobotClient",
    "RecordingSession",
    "Episode",
    "OrobotError",
    "AuthError",
    "NotFoundError",
    "ApiError",
]

__version__ = "0.0.1"
