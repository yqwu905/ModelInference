"""End-to-end API test covering the full hierarchy and pipeline.

Uses a local-path checkpoint copy and the bundled mock inference engine, so it
runs without SSH or a GPU. The VLM evaluation path is exercised in its
unconfigured (graceful-failure) form, which needs no network.
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


def _poll(client: TestClient, url: str, field: str, targets: set[str], timeout: float = 60.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = client.get(url)
        assert r.status_code == 200, r.text
        last = r.json()
        if last[field] in targets:
            return last
        time.sleep(0.3)
    raise AssertionError(f"{url} {field} never reached {targets}; last={last}")


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_full_pipeline(client, tmp_path):
    # --- project (defaults prefill mock inference command + param schema) ---
    r = client.post("/api/projects", json={"name": "Proj", "description": "d"})
    assert r.status_code == 201, r.text
    project = r.json()
    pid = project["id"]
    assert project["inference_command"]
    assert isinstance(project["inference_param_schema"], list)
    assert project["vlm_api_key_set"] is False

    # --- experiment ---
    r = client.post(f"/api/projects/{pid}/experiments",
                    json={"name": "exp1", "hyperparameters": {"lr": 0.001}})
    assert r.status_code == 201, r.text
    eid = r.json()["id"]

    # --- checkpoint: copy from a local source directory ---
    src = tmp_path / "src_ckpt"
    src.mkdir()
    (src / "weights.bin").write_bytes(b"\x00" * 2048)
    (src / "config.json").write_text('{"arch": "demo"}')

    r = client.post(f"/api/experiments/{eid}/checkpoints",
                    json={"display_name": "ckpt-A", "source_host": "", "source_path": str(src)})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    ck = _poll(client, f"/api/checkpoints/{cid}", "status", {"ready", "failed"})
    assert ck["status"] == "ready", ck["message"]
    assert ck["size_bytes"] > 0
    assert (Path(ck["local_path"]) / "weights.bin").exists()

    # --- rename checkpoint (does not touch files) ---
    r = client.put(f"/api/checkpoints/{cid}", json={"display_name": "ckpt-renamed"})
    assert r.status_code == 200 and r.json()["display_name"] == "ckpt-renamed"
    assert (Path(ck["local_path"]) / "weights.bin").exists()

    # --- two inferences (mock engine) ---
    inf_ids = []
    for seed in (1, 2):
        r = client.post(f"/api/checkpoints/{cid}/inferences",
                        json={"name": f"run-{seed}", "params": {"prompt": "a cat", "count": 2, "seed": seed}})
        assert r.status_code == 201, r.text
        inf = r.json()
        assert inf["status"] in {"running", "pending", "done"}
        inf_ids.append(inf["id"])

    for iid in inf_ids:
        done = _poll(client, f"/api/inferences/{iid}", "status", {"done", "failed"})
        assert done["status"] == "done", done["log"]
        imgs = client.get(f"/api/inferences/{iid}/images").json()["images"]
        assert len(imgs) == 2, imgs
        assert all(u.startswith("/files/inferences/") for u in imgs)
        # the static URL resolves
        assert client.get(imgs[0]).status_code == 200

    # --- experiment-level inference listing (for compare picker) ---
    listed = client.get(f"/api/experiments/{eid}/inferences").json()
    assert {i["id"] for i in listed} == set(inf_ids)

    # --- rename inference ---
    assert client.put(f"/api/inferences/{inf_ids[0]}", json={"name": "renamed"}).json()["name"] == "renamed"

    # --- evaluation: not configured -> graceful failure ---
    r = client.post("/api/evaluations",
                    json={"project_id": pid, "inference_a_id": inf_ids[0], "inference_b_id": inf_ids[1]})
    assert r.status_code == 201, r.text
    ev_id = r.json()["id"]
    ev = _poll(client, f"/api/evaluations/{ev_id}", "status", {"done", "failed"})
    assert ev["status"] == "failed"
    assert "not configured" in ev["error"].lower()

    # eval on a not-done / cross-project inference is rejected
    bad = client.post("/api/evaluations",
                      json={"project_id": pid, "inference_a_id": inf_ids[0], "inference_b_id": 999999})
    assert bad.status_code in {400, 404}

    # --- cascade delete ---
    local_paths = [Path(ck["local_path"])]
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404
    assert client.get(f"/api/experiments/{eid}").status_code == 404
    assert client.get(f"/api/checkpoints/{cid}").status_code == 404
    for p in local_paths:
        assert not p.exists(), f"checkpoint files not cleaned up: {p}"


def test_checkpoint_copy_failure(client, tmp_path):
    r = client.post("/api/projects", json={"name": "P2"})
    pid = r.json()["id"]
    eid = client.post(f"/api/projects/{pid}/experiments", json={"name": "e"}).json()["id"]
    # nonexistent local source -> copy should fail
    r = client.post(f"/api/experiments/{eid}/checkpoints",
                    json={"display_name": "bad", "source_host": "", "source_path": str(tmp_path / "nope")})
    cid = r.json()["id"]
    ck = _poll(client, f"/api/checkpoints/{cid}", "status", {"ready", "failed"})
    assert ck["status"] == "failed"
    assert ck["message"]
    # inference on a non-ready checkpoint is rejected
    assert client.post(f"/api/checkpoints/{cid}/inferences",
                       json={"name": "x", "params": {}}).status_code == 409
