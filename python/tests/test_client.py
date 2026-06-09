"""Tests for OrobotClient REST methods, using a fake transport (no network)."""

from __future__ import annotations

import pytest

from orobot import OrobotClient
from orobot.errors import AuthError, NotFoundError


class FakeTransport:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, path):
        self.calls.append(("GET", path))
        value = self.responses[path]
        if isinstance(value, Exception):
            raise value
        return value


def _client_with(responses):
    client = OrobotClient(api_key="ork_live_test")
    client._http = FakeTransport(responses)
    return client


def test_list_robots_bare_list():
    client = _client_with({"/robots": [{"uuid": "r1"}, {"uuid": "r2"}]})
    robots = client.list_robots()
    assert [r["uuid"] for r in robots] == ["r1", "r2"]
    assert client._http.calls == [("GET", "/robots")]


def test_list_robots_wrapped_in_object():
    client = _client_with({"/robots": {"robots": [{"uuid": "r1"}]}})
    assert client.list_robots() == [{"uuid": "r1"}]


def test_list_robots_handles_null():
    client = _client_with({"/robots": None})
    assert client.list_robots() == []


def test_get_robot():
    client = _client_with({"/robot/abc": {"uuid": "abc", "state": {}}})
    robot = client.get_robot("abc")
    assert robot["uuid"] == "abc"
    assert client._http.calls == [("GET", "/robot/abc")]


def test_list_devices_wrapped():
    client = _client_with({"/devices": {"devices": [{"uuid": "d1"}]}})
    assert client.list_devices() == [{"uuid": "d1"}]


def test_get_joint_state_extracts_joints():
    client = _client_with(
        {"/robot/abc": {"uuid": "abc", "state": {"joints": {"j1": 0.5, "j2": "1.0"}}}}
    )
    joints = client.get_joint_state("abc")
    assert joints == {"j1": 0.5, "j2": 1.0}  # coerced to float


def test_get_joint_state_alt_key():
    client = _client_with({"/robot/abc": {"state": {"jointState": {"j1": 0.1}}}})
    assert client.get_joint_state("abc") == {"j1": 0.1}


def test_get_joint_state_missing_state():
    client = _client_with({"/robot/abc": {"uuid": "abc"}})
    assert client.get_joint_state("abc") == {}


def test_auth_error_propagates():
    client = _client_with({"/robots": AuthError("bad key")})
    with pytest.raises(AuthError):
        client.list_robots()


def test_not_found_propagates():
    client = _client_with({"/robot/nope": NotFoundError("404")})
    with pytest.raises(NotFoundError):
        client.get_robot("nope")
