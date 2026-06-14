"""Global settings endpoints — reusable servers and VLM presets.

These are standalone records (no foreign keys into the Project hierarchy)
surfaced in the frontend Settings page:

* **Servers** prefill the checkpoint-copy form (``source_host`` / ``source_path``).
* **VLM presets** can be imported into a project's evaluation config. Because the
  preset api key is redacted on read (like a project's), importing is done
  server-side via the *apply* endpoint, which copies the secret into the project
  without it ever travelling to the browser.

The VLM api key follows the same write-only semantics as ``Project.vlm_api_key``:
provided non-empty => set, empty string => clear, omitted => keep unchanged.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session, select

import json
from pathlib import Path
from urllib.parse import quote

from .. import config
from ..db import get_session
from ..models import InferenceEngine, Project, ServerConfig, TestSet, VlmPreset
from ..schemas import (
    InferenceEngineCreate,
    InferenceEngineUpdate,
    ServerCreate,
    ServerUpdate,
    TestSetCreate,
    TestSetUpdate,
    VlmPresetCreate,
    VlmPresetUpdate,
)
from ..serializers import (
    inference_engine_out,
    project_out,
    server_out,
    test_set_out,
    vlm_preset_out,
)
from ..services import vlm_service

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ---------------------------------------------------------------------------
# Servers
# ---------------------------------------------------------------------------


@router.get("/servers")
def list_servers(session: Session = Depends(get_session)):
    servers = session.exec(select(ServerConfig).order_by(ServerConfig.id.desc())).all()
    return [server_out(s) for s in servers]


@router.post("/servers", status_code=201)
def create_server(body: ServerCreate, session: Session = Depends(get_session)):
    server = ServerConfig(
        name=body.name,
        host=body.host,
        port=body.port,
        default_path=body.default_path,
        description=body.description,
        password=body.password if body.password is not None else "",
    )
    session.add(server)
    session.commit()
    session.refresh(server)
    return server_out(server)


@router.get("/servers/{server_id}")
def get_server(server_id: int, session: Session = Depends(get_session)):
    server = session.get(ServerConfig, server_id)
    if server is None:
        raise HTTPException(404, "server not found")
    return server_out(server)


@router.put("/servers/{server_id}")
def update_server(
    server_id: int,
    body: ServerUpdate,
    session: Session = Depends(get_session),
):
    server = session.get(ServerConfig, server_id)
    if server is None:
        raise HTTPException(404, "server not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        setattr(server, key, value)
    session.add(server)
    session.commit()
    session.refresh(server)
    return server_out(server)


@router.delete("/servers/{server_id}", status_code=204)
def delete_server(server_id: int, session: Session = Depends(get_session)):
    server = session.get(ServerConfig, server_id)
    if server is None:
        raise HTTPException(404, "server not found")
    session.delete(server)
    session.commit()
    return None


# ---------------------------------------------------------------------------
# VLM presets
# ---------------------------------------------------------------------------


@router.get("/vlm-presets")
def list_vlm_presets(session: Session = Depends(get_session)):
    presets = session.exec(select(VlmPreset).order_by(VlmPreset.id.desc())).all()
    return [vlm_preset_out(p) for p in presets]


@router.post("/vlm-presets", status_code=201)
def create_vlm_preset(body: VlmPresetCreate, session: Session = Depends(get_session)):
    preset = VlmPreset(
        name=body.name,
        base_url=body.base_url,
        model=body.model,
        api_key=body.api_key if body.api_key is not None else "",
    )
    session.add(preset)
    session.commit()
    session.refresh(preset)
    return vlm_preset_out(preset)


@router.get("/vlm-presets/{preset_id}")
def get_vlm_preset(preset_id: int, session: Session = Depends(get_session)):
    preset = session.get(VlmPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "preset not found")
    return vlm_preset_out(preset)


@router.put("/vlm-presets/{preset_id}")
def update_vlm_preset(
    preset_id: int,
    body: VlmPresetUpdate,
    session: Session = Depends(get_session),
):
    preset = session.get(VlmPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "preset not found")
    # exclude_unset so an omitted api_key keeps the existing secret; an explicit
    # "" clears it. None is never a valid column value here, so skip it.
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        setattr(preset, key, value)
    session.add(preset)
    session.commit()
    session.refresh(preset)
    return vlm_preset_out(preset)


@router.delete("/vlm-presets/{preset_id}", status_code=204)
def delete_vlm_preset(preset_id: int, session: Session = Depends(get_session)):
    preset = session.get(VlmPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "preset not found")
    session.delete(preset)
    session.commit()
    return None


@router.post("/vlm-presets/{preset_id}/apply/{project_id}")
def apply_vlm_preset(
    preset_id: int,
    project_id: int,
    session: Session = Depends(get_session),
):
    """Copy a preset's base_url, model, and api key into a project.

    The secret is copied server-side so it never reaches the browser. Values are
    copied (not referenced): later edits to the preset do not affect the project.
    """
    preset = session.get(VlmPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "preset not found")
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    project.vlm_base_url = preset.base_url
    project.vlm_model = preset.model
    project.vlm_api_key = preset.api_key
    session.add(project)
    session.commit()
    session.refresh(project)
    return project_out(project)


@router.post("/vlm-presets/{preset_id}/test")
def test_vlm_preset(preset_id: int, session: Session = Depends(get_session)):
    """Probe a preset's endpoint with a minimal request to check it responds.

    Runs server-side so the (redacted) api key never reaches the browser. The
    result is returned as a body (``{"ok", "message", ...}``): a model or
    connection failure is a 200 with ``ok=false``, not an HTTP error — only a
    missing preset is a 404.
    """
    preset = session.get(VlmPreset, preset_id)
    if preset is None:
        raise HTTPException(404, "preset not found")
    return vlm_service.test_endpoint(preset.base_url, preset.model, preset.api_key)


# ---------------------------------------------------------------------------
# Inference engines ("推理工程")
# ---------------------------------------------------------------------------


@router.get("/inference-engines")
def list_inference_engines(session: Session = Depends(get_session)):
    engines = session.exec(
        select(InferenceEngine).order_by(InferenceEngine.id.desc())
    ).all()
    return [inference_engine_out(e) for e in engines]


@router.post("/inference-engines", status_code=201)
def create_inference_engine(
    body: InferenceEngineCreate, session: Session = Depends(get_session)
):
    engine = InferenceEngine(
        name=body.name,
        command=body.command,
        workdir=body.workdir,
        params=json.dumps(body.params),
    )
    session.add(engine)
    session.commit()
    session.refresh(engine)
    return inference_engine_out(engine)


@router.get("/inference-engines/{engine_id}")
def get_inference_engine(engine_id: int, session: Session = Depends(get_session)):
    engine = session.get(InferenceEngine, engine_id)
    if engine is None:
        raise HTTPException(404, "engine not found")
    return inference_engine_out(engine)


@router.put("/inference-engines/{engine_id}")
def update_inference_engine(
    engine_id: int,
    body: InferenceEngineUpdate,
    session: Session = Depends(get_session),
):
    engine = session.get(InferenceEngine, engine_id)
    if engine is None:
        raise HTTPException(404, "engine not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        if key == "params":
            setattr(engine, key, json.dumps(value))
        else:
            setattr(engine, key, value)
    session.add(engine)
    session.commit()
    session.refresh(engine)
    return inference_engine_out(engine)


@router.delete("/inference-engines/{engine_id}", status_code=204)
def delete_inference_engine(engine_id: int, session: Session = Depends(get_session)):
    engine = session.get(InferenceEngine, engine_id)
    if engine is None:
        raise HTTPException(404, "engine not found")
    session.delete(engine)
    session.commit()
    return None


# ---------------------------------------------------------------------------
# Test sets ("测试集")
# ---------------------------------------------------------------------------


@router.get("/test-sets")
def list_test_sets(session: Session = Depends(get_session)):
    test_sets = session.exec(select(TestSet).order_by(TestSet.id.desc())).all()
    return [test_set_out(t) for t in test_sets]


@router.post("/test-sets", status_code=201)
def create_test_set(body: TestSetCreate, session: Session = Depends(get_session)):
    test_set = TestSet(name=body.name, path=body.path, description=body.description)
    session.add(test_set)
    session.commit()
    session.refresh(test_set)
    return test_set_out(test_set)


@router.get("/test-sets/{test_set_id}")
def get_test_set(test_set_id: int, session: Session = Depends(get_session)):
    test_set = session.get(TestSet, test_set_id)
    if test_set is None:
        raise HTTPException(404, "test set not found")
    return test_set_out(test_set)


@router.put("/test-sets/{test_set_id}")
def update_test_set(
    test_set_id: int,
    body: TestSetUpdate,
    session: Session = Depends(get_session),
):
    test_set = session.get(TestSet, test_set_id)
    if test_set is None:
        raise HTTPException(404, "test set not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        setattr(test_set, key, value)
    session.add(test_set)
    session.commit()
    session.refresh(test_set)
    return test_set_out(test_set)


@router.delete("/test-sets/{test_set_id}", status_code=204)
def delete_test_set(test_set_id: int, session: Session = Depends(get_session)):
    test_set = session.get(TestSet, test_set_id)
    if test_set is None:
        raise HTTPException(404, "test set not found")
    session.delete(test_set)
    session.commit()
    return None


@router.get("/test-sets/{test_set_id}/images")
def list_test_set_images(test_set_id: int, session: Session = Depends(get_session)):
    """List the test set folder's image files as URLs to the file endpoint below.

    Unlike inference outputs (served from the static /files mount under DATA_DIR),
    a test set lives at an arbitrary path, so its images are streamed through the
    dedicated ``/file`` endpoint instead. Scans the top level only, matching the
    inference image listing.
    """
    test_set = session.get(TestSet, test_set_id)
    if test_set is None:
        raise HTTPException(404, "test set not found")
    if not test_set.path:
        return {"images": []}
    directory = Path(test_set.path)
    if not directory.is_dir():
        return {"images": []}
    # The path is arbitrary user-supplied text, so iterating it can fail
    # (unreadable directory, or it vanishes after the is_dir() check). Degrade to
    # an empty list rather than a 500, matching the guards above.
    try:
        files = sorted(
            f.name
            for f in directory.iterdir()
            if f.is_file() and f.suffix.lower() in config.IMAGE_EXTENSIONS
        )
    except OSError:
        return {"images": []}
    base = f"/api/settings/test-sets/{test_set_id}/file"
    return {"images": [f"{base}?name={quote(name)}" for name in files]}


@router.get("/test-sets/{test_set_id}/file")
def get_test_set_file(
    test_set_id: int, name: str, session: Session = Depends(get_session)
):
    """Stream a single image file from a test set folder.

    Guards against path traversal: ``name`` must be a bare filename whose resolved
    path sits directly inside the (resolved) test set directory and is a
    recognised image type.
    """
    test_set = session.get(TestSet, test_set_id)
    if test_set is None:
        raise HTTPException(404, "test set not found")
    if not test_set.path:
        raise HTTPException(404, "file not found")
    if "/" in name or "\\" in name or name in ("", ".", ".."):
        raise HTTPException(400, "invalid file name")
    base = Path(test_set.path).resolve()
    target = (base / name).resolve()
    if target.parent != base or not target.is_file():
        raise HTTPException(404, "file not found")
    if target.suffix.lower() not in config.IMAGE_EXTENSIONS:
        raise HTTPException(404, "file not found")
    return FileResponse(str(target))
