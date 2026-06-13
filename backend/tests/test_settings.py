"""Tests for global settings: server configs, VLM presets, inference engines.

Covers CRUD, VLM api-key redaction + keep/clear/set semantics, applying a preset
to a project (server-side secret copy), the project default engine, and the
per-inference engine snapshot used at run time.
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _poll(client, url, field, targets, timeout=30.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = client.get(url)
        assert r.status_code == 200, r.text
        last = r.json()
        if last[field] in targets:
            return last
        time.sleep(0.2)
    raise AssertionError(f"{url} {field} never reached {targets}; last={last}")


# --- servers ---------------------------------------------------------------


def test_server_crud(client):
    r = client.post(
        "/api/settings/servers",
        json={"name": "GPU box", "host": "user@gpu", "default_path": "/data/ckpts"},
    )
    assert r.status_code == 201, r.text
    server = r.json()
    sid = server["id"]
    assert server["name"] == "GPU box"
    assert server["host"] == "user@gpu"
    assert server["default_path"] == "/data/ckpts"

    # list includes it
    r = client.get("/api/settings/servers")
    assert r.status_code == 200
    assert any(s["id"] == sid for s in r.json())

    # get
    assert client.get(f"/api/settings/servers/{sid}").json()["name"] == "GPU box"

    # partial update leaves other fields intact
    r = client.put(f"/api/settings/servers/{sid}", json={"name": "GPU box B"})
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["name"] == "GPU box B"
    assert updated["host"] == "user@gpu"  # unchanged

    # delete
    assert client.delete(f"/api/settings/servers/{sid}").status_code == 204
    assert client.get(f"/api/settings/servers/{sid}").status_code == 404


def test_server_missing_404(client):
    assert client.get("/api/settings/servers/999999").status_code == 404
    assert client.put("/api/settings/servers/999999", json={"name": "x"}).status_code == 404
    assert client.delete("/api/settings/servers/999999").status_code == 404


def test_server_password_redaction_and_semantics(client):
    # create with a password -> redacted on read, never echoes the raw value
    r = client.post(
        "/api/settings/servers",
        json={"name": "pw box", "host": "user@gpu", "password": "p@ss"},
    )
    assert r.status_code == 201, r.text
    server = r.json()
    sid = server["id"]
    assert server["password_set"] is True
    assert "password" not in server
    assert "p@ss" not in r.text

    # omitting password on update keeps the existing one
    r = client.put(f"/api/settings/servers/{sid}", json={"host": "user@gpu2"})
    assert r.status_code == 200, r.text
    assert r.json()["host"] == "user@gpu2"
    assert r.json()["password_set"] is True

    # explicit empty string clears it
    r = client.put(f"/api/settings/servers/{sid}", json={"password": ""})
    assert r.status_code == 200, r.text
    assert r.json()["password_set"] is False

    # setting a new password flips it back on
    r = client.put(f"/api/settings/servers/{sid}", json={"password": "new"})
    assert r.status_code == 200, r.text
    assert r.json()["password_set"] is True


def test_server_create_without_password(client):
    r = client.post("/api/settings/servers", json={"name": "nopw"})
    assert r.status_code == 201, r.text
    assert r.json()["password_set"] is False


def test_server_port_roundtrip_and_default(client):
    # explicit port is stored and returned
    r = client.post(
        "/api/settings/servers",
        json={"name": "ported", "host": "user@gpu", "port": 2222},
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert r.json()["port"] == 2222

    # omitting the port defaults to 22
    r = client.post("/api/settings/servers", json={"name": "default-port"})
    assert r.json()["port"] == 22

    # update changes it; omitting it on a later update keeps it
    assert client.put(f"/api/settings/servers/{sid}", json={"port": 2022}).json()["port"] == 2022
    assert client.put(f"/api/settings/servers/{sid}", json={"name": "p2"}).json()["port"] == 2022


# --- checkpoint copy: saved server password drives ssh auth ----------------


class _FakeCompleted:
    """Stand-in for subprocess.CompletedProcess on a successful transfer."""

    returncode = 0
    stdout = ""
    stderr = ""


def _insert_remote_checkpoint(local_path: str, host: str) -> int:
    """Insert a pending remote checkpoint directly, returning its id.

    Bypasses the create endpoint so no async copy fires before the test has
    monkeypatched subprocess; the test then calls copy_checkpoint synchronously.
    """
    from app import db
    from app.models import Checkpoint, Experiment, Project

    with db.session_scope() as s:
        proj = Project(name="P")
        s.add(proj)
        s.commit()
        s.refresh(proj)
        exp = Experiment(project_id=proj.id, name="e")
        s.add(exp)
        s.commit()
        s.refresh(exp)
        ck = Checkpoint(
            experiment_id=exp.id,
            display_name="c",
            source_host=host,
            source_path="/remote/ckpt",
            local_path=local_path,
            status="pending",
        )
        s.add(ck)
        s.commit()
        s.refresh(ck)
        return ck.id


def test_copy_uses_sshpass_when_server_password_saved(client, tmp_path, monkeypatch):
    from app.services import copy_service

    client.post(
        "/api/settings/servers",
        json={"name": "pw", "host": "user@gpu", "password": "s3cret"},
    )

    captured: dict = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs.get("env")
        return _FakeCompleted()

    # rsync + sshpass both "installed".
    monkeypatch.setattr(copy_service.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(copy_service.subprocess, "run", fake_run)

    cid = _insert_remote_checkpoint(str(tmp_path / "dst"), "user@gpu")
    copy_service.copy_checkpoint(cid)

    cmd = captured["cmd"]
    assert cmd[:2] == ["sshpass", "-e"]
    assert "rsync" in cmd
    # password auth requires BatchMode=no in the ssh transport spec
    assert any("BatchMode=no" in part for part in cmd)
    # the secret travels via the env, never on argv
    assert captured["env"]["SSHPASS"] == "s3cret"
    assert not any("s3cret" in str(part) for part in cmd)

    assert client.get(f"/api/checkpoints/{cid}").json()["status"] == "ready"


def test_copy_without_saved_password_stays_batchmode_yes(client, tmp_path, monkeypatch):
    from app.services import copy_service

    captured: dict = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs.get("env")
        return _FakeCompleted()

    monkeypatch.setattr(copy_service.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(copy_service.subprocess, "run", fake_run)

    # No server saved for this host => key-only auth, fail-fast BatchMode=yes.
    cid = _insert_remote_checkpoint(str(tmp_path / "dst"), "user@nokey")
    copy_service.copy_checkpoint(cid)

    cmd = captured["cmd"]
    assert cmd[0] != "sshpass"
    assert any("BatchMode=yes" in part for part in cmd)
    assert captured["env"] is None
    # default port 22 => no explicit -p in the ssh transport
    assert not any("-p " in part for part in cmd)


def test_copy_passes_custom_port(client, tmp_path, monkeypatch):
    from app.services import copy_service

    client.post(
        "/api/settings/servers",
        json={"name": "ported", "host": "user@ported", "port": 2222},
    )

    captured: dict = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs.get("env")
        return _FakeCompleted()

    monkeypatch.setattr(copy_service.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(copy_service.subprocess, "run", fake_run)

    cid = _insert_remote_checkpoint(str(tmp_path / "dst"), "user@ported")
    copy_service.copy_checkpoint(cid)

    cmd = captured["cmd"]
    # rsync carries the port inside its ssh transport (`-e "ssh ... -p 2222"`)
    assert any("-p 2222" in part for part in cmd)
    assert cmd[0] != "sshpass"  # no password configured for this host
    assert client.get(f"/api/checkpoints/{cid}").json()["status"] == "ready"


def test_copy_fails_clearly_when_sshpass_missing(client, tmp_path, monkeypatch):
    from app.services import copy_service

    client.post(
        "/api/settings/servers",
        json={"name": "pw2", "host": "user@nosshpass", "password": "x"},
    )

    # rsync present, sshpass absent.
    monkeypatch.setattr(
        copy_service.shutil,
        "which",
        lambda name: None if name == "sshpass" else f"/usr/bin/{name}",
    )

    cid = _insert_remote_checkpoint(str(tmp_path / "dst"), "user@nosshpass")
    copy_service.copy_checkpoint(cid)

    ck = client.get(f"/api/checkpoints/{cid}").json()
    assert ck["status"] == "failed"
    assert "sshpass" in ck["message"]


# --- VLM presets -----------------------------------------------------------


def test_vlm_preset_redaction_and_key_semantics(client):
    # create with a key -> redacted on read, never echoes raw key
    r = client.post(
        "/api/settings/vlm-presets",
        json={"name": "openai", "base_url": "https://api.openai.com/v1",
              "model": "gpt-4o-mini", "api_key": "sk-secret"},
    )
    assert r.status_code == 201, r.text
    preset = r.json()
    pid = preset["id"]
    assert preset["api_key_set"] is True
    assert "api_key" not in preset
    assert "sk-secret" not in r.text

    # omitting api_key on update keeps the existing key
    r = client.put(f"/api/settings/vlm-presets/{pid}", json={"model": "gpt-4o"})
    assert r.status_code == 200, r.text
    assert r.json()["model"] == "gpt-4o"
    assert r.json()["api_key_set"] is True

    # explicit empty string clears the key
    r = client.put(f"/api/settings/vlm-presets/{pid}", json={"api_key": ""})
    assert r.status_code == 200, r.text
    assert r.json()["api_key_set"] is False

    # setting a new key flips it back on
    r = client.put(f"/api/settings/vlm-presets/{pid}", json={"api_key": "sk-new"})
    assert r.status_code == 200, r.text
    assert r.json()["api_key_set"] is True

    # list + delete
    assert any(p["id"] == pid for p in client.get("/api/settings/vlm-presets").json())
    assert client.delete(f"/api/settings/vlm-presets/{pid}").status_code == 204
    assert client.get(f"/api/settings/vlm-presets/{pid}").status_code == 404


def test_vlm_preset_create_without_key(client):
    r = client.post("/api/settings/vlm-presets", json={"name": "local"})
    assert r.status_code == 201, r.text
    assert r.json()["api_key_set"] is False


def test_apply_preset_to_project(client):
    # a project starts without VLM config
    pr = client.post("/api/projects", json={"name": "P"})
    assert pr.status_code == 201, pr.text
    project = pr.json()
    assert project["vlm_api_key_set"] is False

    preset = client.post(
        "/api/settings/vlm-presets",
        json={"name": "v", "base_url": "https://vlm.example/v1",
              "model": "qwen-vl", "api_key": "sk-apply"},
    ).json()

    r = client.post(f"/api/settings/vlm-presets/{preset['id']}/apply/{project['id']}")
    assert r.status_code == 200, r.text
    applied = r.json()
    assert applied["vlm_base_url"] == "https://vlm.example/v1"
    assert applied["vlm_model"] == "qwen-vl"
    assert applied["vlm_api_key_set"] is True  # secret copied server-side
    assert "sk-apply" not in r.text

    # the project really persisted the change
    fetched = client.get(f"/api/projects/{project['id']}").json()
    assert fetched["vlm_model"] == "qwen-vl"
    assert fetched["vlm_api_key_set"] is True


def test_apply_preset_404s(client):
    pr = client.post("/api/projects", json={"name": "P2"}).json()
    preset = client.post("/api/settings/vlm-presets", json={"name": "v2"}).json()
    assert client.post(f"/api/settings/vlm-presets/999999/apply/{pr['id']}").status_code == 404
    assert client.post(f"/api/settings/vlm-presets/{preset['id']}/apply/999999").status_code == 404


# --- VLM preset test (endpoint probe) --------------------------------------


class _FakeResponse:
    """Minimal stand-in for an httpx.Response in the happy-path probe test."""

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    """Drop-in for httpx.Client that echoes a well-formed chat completion."""

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, url, json=None, headers=None):
        return _FakeResponse(
            {"model": json["model"], "choices": [{"message": {"content": "ok"}}]}
        )


def test_vlm_preset_test_success(client, monkeypatch):
    from app.services import vlm_service

    monkeypatch.setattr(vlm_service.httpx, "Client", _FakeClient)
    preset = client.post(
        "/api/settings/vlm-presets",
        json={"name": "t", "base_url": "https://vlm.example/v1",
              "model": "qwen-vl", "api_key": "sk-x"},
    ).json()

    r = client.post(f"/api/settings/vlm-presets/{preset['id']}/test")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["reply"] == "ok"
    assert body["model"] == "qwen-vl"
    assert isinstance(body["latency_ms"], int)


def test_vlm_preset_test_unconfigured(client):
    # No base_url/model -> short-circuits to ok=false without any network call.
    preset = client.post("/api/settings/vlm-presets", json={"name": "empty"}).json()
    r = client.post(f"/api/settings/vlm-presets/{preset['id']}/test")
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is False


def test_vlm_preset_test_missing_404(client):
    assert client.post("/api/settings/vlm-presets/999999/test").status_code == 404


# --- inference engines -----------------------------------------------------


def test_inference_engine_crud(client):
    r = client.post(
        "/api/settings/inference-engines",
        json={"name": "mock", "command": "echo hi", "workdir": "/tmp",
              "params": {"prompt": "a cat", "count": "4"}},
    )
    assert r.status_code == 201, r.text
    eng = r.json()
    eid = eng["id"]
    assert eng["command"] == "echo hi"
    assert eng["params"] == {"prompt": "a cat", "count": "4"}

    assert any(e["id"] == eid for e in client.get("/api/settings/inference-engines").json())
    assert client.get(f"/api/settings/inference-engines/{eid}").json()["name"] == "mock"

    # partial update: change params, keep command
    r = client.put(
        f"/api/settings/inference-engines/{eid}", json={"params": {"seed": "7"}}
    )
    assert r.status_code == 200, r.text
    assert r.json()["params"] == {"seed": "7"}
    assert r.json()["command"] == "echo hi"  # unchanged

    assert client.delete(f"/api/settings/inference-engines/{eid}").status_code == 204
    assert client.get(f"/api/settings/inference-engines/{eid}").status_code == 404


def test_inference_engine_missing_404(client):
    assert client.get("/api/settings/inference-engines/999999").status_code == 404
    assert client.put("/api/settings/inference-engines/999999", json={"name": "x"}).status_code == 404
    assert client.delete("/api/settings/inference-engines/999999").status_code == 404


def test_project_default_engine_roundtrip_and_clear(client):
    eng = client.post(
        "/api/settings/inference-engines", json={"name": "e", "command": "echo x"}
    ).json()
    proj = client.post("/api/projects", json={"name": "P"}).json()
    assert proj["default_engine_id"] is None

    # set
    r = client.put(f"/api/projects/{proj['id']}", json={"default_engine_id": eng["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["default_engine_id"] == eng["id"]
    assert client.get(f"/api/projects/{proj['id']}").json()["default_engine_id"] == eng["id"]

    # explicit null clears it
    r = client.put(f"/api/projects/{proj['id']}", json={"default_engine_id": None})
    assert r.status_code == 200, r.text
    assert r.json()["default_engine_id"] is None


def test_inference_snapshots_engine_and_runs_it(client, tmp_path):
    # project (its default mock command would be used if no engine is given)
    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    eid = client.post(
        f"/api/projects/{pid}/experiments", json={"name": "exp"}
    ).json()["id"]

    # ready checkpoint via local copy
    src = tmp_path / "ckpt"
    src.mkdir()
    (src / "w.bin").write_bytes(b"\x00" * 16)
    cid = client.post(
        f"/api/experiments/{eid}/checkpoints",
        json={"display_name": "c", "source_host": "", "source_path": str(src)},
    ).json()["id"]
    _poll(client, f"/api/checkpoints/{cid}", "status", {"ready", "failed"})

    # an engine whose command is a plain echo (runs without PIL/GPU) and differs
    # from the project's default mock command, so we can prove it was used.
    engine = client.post(
        "/api/settings/inference-engines",
        json={"name": "echoer", "command": "echo from-engine-MARKER", "workdir": ""},
    ).json()

    r = client.post(
        f"/api/checkpoints/{cid}/inferences",
        json={"name": "run", "params": {}, "engine_id": engine["id"]},
    )
    assert r.status_code == 201, r.text
    created = r.json()
    # command/workdir are snapshotted onto the inference at creation
    assert created["command"] == "echo from-engine-MARKER"
    assert created["workdir"] == ""

    done = _poll(client, f"/api/inferences/{created['id']}", "status", {"done", "failed"})
    # echo returns 0 -> done, and the snapshot command (not the project default)
    # is what actually ran.
    assert done["status"] == "done", done["log"]
    assert "from-engine-MARKER" in done["log"]


def test_inference_with_bad_engine_id_404(client, tmp_path):
    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    eid = client.post(f"/api/projects/{pid}/experiments", json={"name": "e"}).json()["id"]
    src = tmp_path / "ck"
    src.mkdir()
    (src / "w.bin").write_bytes(b"\x00" * 8)
    cid = client.post(
        f"/api/experiments/{eid}/checkpoints",
        json={"display_name": "c", "source_host": "", "source_path": str(src)},
    ).json()["id"]
    _poll(client, f"/api/checkpoints/{cid}", "status", {"ready", "failed"})

    r = client.post(
        f"/api/checkpoints/{cid}/inferences",
        json={"name": "run", "params": {}, "engine_id": 999999},
    )
    assert r.status_code == 404, r.text
