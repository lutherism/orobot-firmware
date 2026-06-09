"""The export path is deferred (orobotio#3252) and must fail loudly with a pointer."""

from __future__ import annotations

import pytest

from orobot import OrobotClient
from orobot.export import to_lerobot_dataset


def test_export_raises_not_implemented_with_pointer(tmp_path):
    with pytest.raises(NotImplementedError) as exc:
        to_lerobot_dataset(tmp_path, repo_id="user/data")
    assert "3252" in str(exc.value)


def test_client_export_delegates_and_raises(tmp_path):
    client = OrobotClient(api_key="k")
    with pytest.raises(NotImplementedError):
        client.export_lerobot_dataset(tmp_path, repo_id="user/data")
