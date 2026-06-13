"""Regression tests for issues found in the adversarial review.

Each test maps to a confirmed finding so the fixed behaviour stays fixed.
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.inference_service import _append_params, _render
from app.services.vlm_service import _strip_code_fence


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


# --- #4: command rendering must not choke on legitimate braces ---
def test_render_substitutes_known_tokens_and_preserves_braces():
    out = _render(
        'infer --ckpt {checkpoint} --out {output_dir} --steps {steps} '
        'cp f{,.bak} {0} {unknown} ${HOME}',
        {"checkpoint": "/c", "output_dir": "/o", "steps": 20},
    )
    assert "--ckpt /c" in out
    assert "--out /o" in out
    assert "--steps 20" in out
    # shell brace expansion, positional braces, unknown tokens, $VAR: untouched
    assert "f{,.bak}" in out
    assert "{0}" in out
    assert "{unknown}" in out
    assert "${HOME}" in out


# --- engine key/value params reach the command line ---
def test_append_params_adds_unreferenced_as_flags():
    template = "python infer.py --ckpt {checkpoint} --out {output_dir}"
    params = {"prompt": "a cat", "steps": "20"}
    # _render only fills {tokens}; the params aren't referenced, so they must be
    # appended as flags (value shell-quoted).
    rendered = _render(template, {**params, "checkpoint": "/c", "output_dir": "/o"})
    out = _append_params(rendered, template, params)
    assert "--ckpt /c" in out
    assert "--out /o" in out
    assert "--prompt 'a cat'" in out
    assert "--steps 20" in out


def test_append_params_skips_templated_params():
    # A param referenced via {prompt} is substituted in place, not re-appended.
    template = "infer --prompt {prompt} --ckpt {checkpoint}"
    params = {"prompt": "hello"}
    rendered = _render(template, {**params, "checkpoint": "/c"})
    out = _append_params(rendered, template, params)
    assert out.count("--prompt") == 1
    assert "--prompt hello" in out


def test_append_params_empty_value_is_bare_flag():
    # Empty value => a switch (`--fp16`), non-empty => `--key value`.
    out = _append_params("infer", "infer", {"fp16": "", "seed": "7"})
    assert out == "infer --fp16 --seed 7"


# --- #3: fence stripping handles inline + own-line + bare JSON ---
@pytest.mark.parametrize(
    "text",
    [
        '{"winner": "A"}',
        '```json\n{"winner": "A"}\n```',
        '```\n{"winner": "A"}\n```',
        '```json {"winner": "A"}```',
        '```json {"winner": "A"}',
    ],
)
def test_strip_code_fence_yields_parseable_json(text):
    import json

    assert json.loads(_strip_code_fence(text)) == {"winner": "A"}


# --- #1: a single-file checkpoint source copies successfully ---
def test_single_file_checkpoint_copy(client, tmp_path):
    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    eid = client.post(f"/api/projects/{pid}/experiments", json={"name": "e"}).json()["id"]
    src_file = tmp_path / "model.safetensors"
    src_file.write_bytes(b"\x01" * 4096)

    r = client.post(
        f"/api/experiments/{eid}/checkpoints",
        json={"display_name": "single", "source_host": "", "source_path": str(src_file)},
    )
    cid = r.json()["id"]
    ck = _poll(client, f"/api/checkpoints/{cid}", "status", {"ready", "failed"})
    assert ck["status"] == "ready", ck["message"]
    assert ck["size_bytes"] == 4096
    assert (Path(ck["local_path"]) / "model.safetensors").exists()


# --- #5: PUT with explicit null neither 500s nor corrupts the param schema ---
def test_project_update_rejects_null_gracefully(client):
    pid = client.post("/api/projects", json={"name": "Keep"}).json()["id"]

    # explicit null on a NOT NULL column -> no 500, value unchanged
    r = client.put(f"/api/projects/{pid}", json={"name": None})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Keep"

    # explicit null on the param schema -> stays a list, not JSON null
    r = client.put(f"/api/projects/{pid}", json={"inference_param_schema": None})
    assert r.status_code == 200
    assert isinstance(r.json()["inference_param_schema"], list)


# --- #8: images endpoint tolerates an output_dir outside DATA_DIR ---
def test_images_endpoint_no_500_for_external_output_dir(client, tmp_path):
    from app import db
    from app.models import Inference

    # Create an inference row whose output_dir is outside DATA_DIR and holds an image.
    (tmp_path / "image_000.png").write_bytes(b"\x89PNG\r\n")
    with db.session_scope() as s:
        inf = Inference(
            checkpoint_id=1, experiment_id=1, name="x",
            params="{}", status="done", output_dir=str(tmp_path),
        )
        s.add(inf)
        s.commit()
        s.refresh(inf)
        inf_id = inf.id

    r = client.get(f"/api/inferences/{inf_id}/images")
    assert r.status_code == 200
    assert r.json()["images"] == []  # external file is not servable -> skipped
