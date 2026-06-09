"""OrobotClient — the top-level entry point for the SDK.

Wraps the REST gateway with a small, typed-enough surface and hands out
``RecordingSession`` objects. The REST methods here map 1:1 onto gateway routes
that already accept Bearer API keys (orobotio#1847):

    list_robots()        -> GET  /robots          (scope: robots:read)
    get_robot(uuid)      -> GET  /robot/:uuid      (public; key optional)
    list_devices()       -> GET  /devices          (scope: devices:read)

The recording/export surface is documented on the respective methods.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ._http import DEFAULT_BASE_URL, HttpTransport
from .recording import Episode, RecordingSession


class OrobotClient:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ):
        """Create a client.

        Args:
            api_key: An orobot API key (``ork_live_...``). Mint one in the
                developer portal (POST /api/user/api-keys) with at least the
                ``robots:read`` scope. May be omitted for read-only access to
                public robot pages, but recording requires a key.
            base_url: Gateway origin. Defaults to production. Point at
                ``http://localhost:8080`` for local dev against the gateway.
            timeout: Per-request timeout in seconds.
        """
        self.api_key = api_key
        self._http = HttpTransport(base_url, api_key, timeout=timeout)

    # -- reads ---------------------------------------------------------------
    def list_robots(self) -> list[dict[str, Any]]:
        """List the robots owned by the authenticated user (requires robots:read)."""
        result = self._http.get("/robots")
        # The gateway returns either a bare list or { robots: [...] } depending
        # on the route version; normalize to a list.
        if isinstance(result, dict) and "robots" in result:
            return result["robots"]
        return result or []

    def get_robot(self, robot_uuid: str) -> dict[str, Any]:
        """Fetch a single robot, including its current ``state`` snapshot.

        The ``state`` field carries the realtime device/joint state joined from
        Firestore — this is the polling source for joint positions until the
        ``/control`` WebSocket live stream lands (orobotio#3252).
        """
        return self._http.get(f"/robot/{robot_uuid}")

    def list_devices(self) -> list[dict[str, Any]]:
        """List the authenticated user's devices (requires devices:read)."""
        result = self._http.get("/devices")
        if isinstance(result, dict) and "devices" in result:
            return result["devices"]
        return result or []

    def get_joint_state(self, robot_uuid: str) -> dict[str, float]:
        """Best-effort current joint positions for ``robot_uuid``.

        Reads the robot's ``state`` snapshot and extracts joint positions. The
        exact shape of live joint telemetry is finalized alongside the recording
        pipeline (orobotio#3252); this helper centralizes the extraction so the
        recording loop has one place to change when that lands.
        """
        robot = self.get_robot(robot_uuid)
        state = robot.get("state") or {}
        joints = state.get("joints") or state.get("jointState") or {}
        # Normalize to {name: float}.
        return {str(k): float(v) for k, v in joints.items()} if isinstance(joints, dict) else {}

    # -- recording -----------------------------------------------------------
    def record(
        self,
        robot_uuid: str,
        *,
        output_dir: str | Path,
        fps: float = 30.0,
        joint_names: list[str] | None = None,
    ) -> RecordingSession:
        """Open a recording session writing to ``output_dir``.

        Returns a ``RecordingSession`` context manager. Frames are appended via
        the session's ``add_frame`` (driven by the live stream once #3252 lands,
        or explicitly today). Example::

            with client.record(uuid, output_dir="./ep0") as session:
                session.wait_for_stop()
        """
        episode = Episode(
            output_dir=Path(output_dir),
            robot_uuid=robot_uuid,
            fps=fps,
            joint_names=joint_names or [],
        )
        return RecordingSession(episode)

    # -- export --------------------------------------------------------------
    def export_lerobot_dataset(
        self,
        data_dir: str | Path,
        *,
        repo_id: str,
        push_to_hub: bool = False,
    ) -> None:
        """Convert recorded episodes under ``data_dir`` to a ``LeRobotDataset``.

        Deferred: this depends on the platform-side recording pipeline
        (orobotio#3252) finalizing the camera-frame/MP4 and joint-timeseries
        contract. Raises ``NotImplementedError`` with a tracking pointer until
        then — see ``orobot.export.to_lerobot_dataset``.
        """
        from .export import to_lerobot_dataset

        to_lerobot_dataset(data_dir, repo_id=repo_id, push_to_hub=push_to_hub)
