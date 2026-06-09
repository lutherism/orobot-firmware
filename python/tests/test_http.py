"""Tests for the stdlib HTTP transport: URL building, auth header, status mapping."""

from __future__ import annotations

import io
import urllib.error

import pytest

from orobot._http import HttpTransport
from orobot.errors import ApiError, AuthError, NotFoundError


def test_base_url_and_prefix(monkeypatch):
    captured = {}

    class FakeResp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["auth"] = req.get_header("Authorization")
        return FakeResp(b'{"ok": true}')

    monkeypatch.setattr("orobot._http.urllib.request.urlopen", fake_urlopen)
    t = HttpTransport("https://orobot.io/", "ork_live_abc")
    result = t.get("/robots")

    assert result == {"ok": True}
    assert captured["url"] == "https://orobot.io/api/robots"
    assert captured["method"] == "GET"
    assert captured["auth"] == "Bearer ork_live_abc"


def test_no_api_key_omits_auth(monkeypatch):
    captured = {}

    class FakeResp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=None):
        captured["auth"] = req.get_header("Authorization")
        return FakeResp(b"")

    monkeypatch.setattr("orobot._http.urllib.request.urlopen", fake_urlopen)
    t = HttpTransport("https://orobot.io", None)
    assert t.get("/robot/x") is None
    assert captured["auth"] is None


def _http_error(code):
    return urllib.error.HTTPError(
        url="https://orobot.io/api/x", code=code, msg="err", hdrs=None,
        fp=io.BytesIO(b'{"error":"x"}'),
    )


@pytest.mark.parametrize("code,exc", [(401, AuthError), (403, AuthError), (404, NotFoundError), (500, ApiError)])
def test_status_mapping(monkeypatch, code, exc):
    def fake_urlopen(req, timeout=None):
        raise _http_error(code)

    monkeypatch.setattr("orobot._http.urllib.request.urlopen", fake_urlopen)
    t = HttpTransport("https://orobot.io", "k")
    with pytest.raises(exc):
        t.get("/x")


def test_network_error_is_apierror(monkeypatch):
    def fake_urlopen(req, timeout=None):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr("orobot._http.urllib.request.urlopen", fake_urlopen)
    t = HttpTransport("http://localhost:8080", "k")
    with pytest.raises(ApiError):
        t.get("/robots")
