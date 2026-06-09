"""Exception hierarchy for the orobot SDK.

A single base (``OrobotError``) so callers can ``except OrobotError`` to catch
everything, with specific subclasses for the cases a script usually wants to
branch on (bad key vs. missing resource vs. some other gateway failure).
"""

from __future__ import annotations


class OrobotError(Exception):
    """Base class for all errors raised by this SDK."""


class AuthError(OrobotError):
    """The API key was missing, malformed, revoked, or lacks the required scope.

    Corresponds to a 401/403 from the gateway. The orobot gateway returns 401
    for an unknown/revoked Bearer token and 403 when the key is valid but its
    scopes do not cover the requested resource.
    """


class NotFoundError(OrobotError):
    """The requested robot/device/resource does not exist (HTTP 404)."""


class ApiError(OrobotError):
    """A gateway error that isn't auth- or not-found-shaped.

    Carries the HTTP status and raw response body so callers can inspect it.
    """

    def __init__(self, message: str, *, status: int | None = None, body: str | None = None):
        super().__init__(message)
        self.status = status
        self.body = body
