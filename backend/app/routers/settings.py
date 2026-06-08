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
from sqlmodel import Session, select

import json

from ..db import get_session
from ..models import InferenceEngine, Project, ServerConfig, VlmPreset
from ..schemas import (
    InferenceEngineCreate,
    InferenceEngineUpdate,
    ServerCreate,
    ServerUpdate,
    VlmPresetCreate,
    VlmPresetUpdate,
)
from ..serializers import (
    inference_engine_out,
    project_out,
    server_out,
    vlm_preset_out,
)

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
        default_path=body.default_path,
        description=body.description,
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
