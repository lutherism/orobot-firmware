"""Minimal stdlib HTTP transport for the orobot gateway.

We deliberately avoid ``requests``/``httpx`` so the core package has zero
third-party dependencies and installs instantly in a bare Colab kernel.

Auth model (matches the gateway, orobotio#1847):
- API keys authenticate via ``Authorization: Bearer <plaintext>``.
- The gateway global prefix is ``/api``; callers here pass paths WITHOUT it
  (e.g. ``/robots``) and this layer prepends ``/api``.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Mapping

from .errors import ApiError, AuthError, NotFoundError

DEFAULT_BASE_URL = "https://orobot.io"
API_PREFIX = "/api"


class HttpTransport:
    def __init__(self, base_url: str, api_key: str | None, *, timeout: float = 30.0):
        # Tolerate trailing slashes so base_url="https://orobot.io/" works.
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def request(
        self,
        method: str,
        path: str,
        *,
        body: Mapping[str, Any] | None = None,
    ) -> Any:
        url = f"{self.base_url}{API_PREFIX}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                if not raw:
                    return None
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            self._raise_for_status(exc)
        except urllib.error.URLError as exc:  # DNS, connection refused, TLS, ...
            raise ApiError(f"network error reaching {url}: {exc.reason}") from exc

    @staticmethod
    def _raise_for_status(exc: "urllib.error.HTTPError") -> None:
        status = exc.code
        try:
            body = exc.read().decode("utf-8")
        except Exception:  # pragma: no cover - body read is best-effort
            body = ""
        if status in (401, 403):
            raise AuthError(
                f"authentication/authorization failed (HTTP {status}). "
                "Check that your API key is valid and has the required scope "
                f"(robots:read / devices:read). Response: {body}"
            )
        if status == 404:
            raise NotFoundError(f"resource not found (HTTP 404): {body}")
        raise ApiError(f"gateway returned HTTP {status}", status=status, body=body)

    def get(self, path: str) -> Any:
        return self.request("GET", path)

    def post(self, path: str, body: Mapping[str, Any] | None = None) -> Any:
        return self.request("POST", path, body=body)
