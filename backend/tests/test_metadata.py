"""Tests for loading config.yaml as checkpoint metadata."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.copy_service import _load_config_metadata


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _poll(client, url, field, targets, timeout=60.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(url).json()
        if last[field] in targets:
            return last
        time.sleep(0.3)
    raise AssertionError(f"{url}.{field} never reached {targets}; last={last}")


# --- unit tests for the parser ---
def test_load_config_metadata_parses_yaml(tmp_path):
    (tmp_path / "config.yaml").write_text(
        "model: unet\nlr: 0.001\nlayers:\n  - a\n  - b\n"
    )
    assert _load_config_metadata(str(tmp_path)) == {
        "model": "unet",
        "lr": 0.001,
        "layers": ["a", "b"],
    }


def test_load_config_metadata_yml_variant(tmp_path):
    (tmp_path / "config.yml").write_text("seed: 7\n")
    assert _load_config_metadata(str(tmp_path)) == {"seed": 7}


def test_load_config_metadata_missing_is_empty(tmp_path):
    assert _load_config_metadata(str(tmp_path)) == {}


def test_load_config_metadata_malformed_is_empty(tmp_path):
    (tmp_path / "config.yaml").write_text("key: : : not valid: [\n")
    assert _load_config_metadata(str(tmp_path)) == {}


def test_load_config_metadata_non_mapping_is_empty(tmp_path):
    (tmp_path / "config.yaml").write_text("- just\n- a\n- list\n")
    assert _load_config_metadata(str(tmp_path)) == {}


def test_load_config_metadata_alias_bomb_rejected(tmp_path):
    # "billion laughs": valid YAML, but aliases would expand enormously.
    bomb = (
        "a: &a [x, x, x, x, x, x, x, x, x]\n"
        "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]\n"
        "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]\n"
        "d: [*c, *c, *c, *c, *c, *c, *c, *c, *c]\n"
    )
    (tmp_path / "config.yaml").write_text(bomb)
    # Rejected at parse time (no alias expansion, no OOM) -> {}.
    assert _load_config_metadata(str(tmp_path)) == {}


def test_load_config_metadata_oversized_rejected(tmp_path):
    (tmp_path / "config.yaml").write_text("key: " + ("v" * (1024 * 1024 + 16)) + "\n")
    assert _load_config_metadata(str(tmp_path)) == {}


# --- end-to-end: a directory checkpoint with config.yaml gets metadata ---
def test_directory_checkpoint_metadata_via_api(client, tmp_path):
    pid = client.post("/api/projects", json={"name": "M"}).json()["id"]
    eid = client.post(f"/api/projects/{pid}/experiments", json={"name": "e"}).json()["id"]

    src = tmp_path / "ckpt"
    src.mkdir()
    (src / "weights.bin").write_bytes(b"\x00" * 256)
    (src / "config.yaml").write_text(
        "base_model: sd-xl\nsteps: 30\nguidance: 7.5\ntags:\n  - lora\n"
    )

    r = client.post(
        f"/api/experiments/{eid}/checkpoints",
        json={"display_name": "with-config", "source_host": "", "source_path": str(src)},
    )
    cid = r.json()["id"]
    ck = _poll(client, f"/api/checkpoints/{cid}", "status", {"ready", "failed"})
    assert ck["status"] == "ready", ck["message"]
    assert ck["metadata"] == {
        "base_model": "sd-xl",
        "steps": 30,
        "guidance": 7.5,
        "tags": ["lora"],
    }


def test_directory_checkpoint_without_config_has_empty_metadata(client, tmp_path):
    pid = client.post("/api/projects", json={"name": "M2"}).json()["id"]
    eid = client.post(f"/api/projects/{pid}/experiments", json={"name": "e"}).json()["id"]

    src = tmp_path / "plain"
    src.mkdir()
    (src / "weights.bin").write_bytes(b"\x00" * 64)

    r = client.post(
        f"/api/experiments/{eid}/checkpoints",
        json={"display_name": "no-config", "source_host": "", "source_path": str(src)},
    )
    cid = r.json()["id"]
    ck = _poll(client, f"/api/checkpoints/{cid}", "status", {"ready", "failed"})
    assert ck["status"] == "ready"
    assert ck["metadata"] == {}
