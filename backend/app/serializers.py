"""Convert ORM rows into JSON-serialisable API payloads.

JSON-typed columns (stored as TEXT) are parsed back into objects, and secrets
(the VLM api key) are redacted to a boolean ``vlm_api_key_set`` flag.
"""
from __future__ import annotations

import json
from typing import Any

from .models import (
    Checkpoint,
    Evaluation,
    Experiment,
    Inference,
    InferenceEngine,
    Project,
    ServerConfig,
    VlmPreset,
)


def _loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value) if value else fallback
    except (ValueError, TypeError):
        return fallback


def project_out(p: Project) -> dict[str, Any]:
    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "inference_command": p.inference_command,
        "inference_workdir": p.inference_workdir,
        "inference_param_schema": _loads(p.inference_param_schema, []),
        "default_engine_id": p.default_engine_id,
        "vlm_base_url": p.vlm_base_url,
        "vlm_model": p.vlm_model,
        # Never return the raw key; expose only whether one is configured.
        "vlm_api_key_set": bool(p.vlm_api_key),
        "eval_prompt": p.eval_prompt,
        "created_at": p.created_at.isoformat(),
    }


def experiment_out(e: Experiment) -> dict[str, Any]:
    return {
        "id": e.id,
        "project_id": e.project_id,
        "name": e.name,
        "description": e.description,
        "hyperparameters": _loads(e.hyperparameters, {}),
        "created_at": e.created_at.isoformat(),
    }


def checkpoint_out(c: Checkpoint) -> dict[str, Any]:
    return {
        "id": c.id,
        "experiment_id": c.experiment_id,
        "display_name": c.display_name,
        "source_host": c.source_host,
        "source_path": c.source_path,
        "local_path": c.local_path,
        "status": c.status,
        "size_bytes": c.size_bytes,
        "message": c.message,
        # Parsed config.yaml of a directory checkpoint (empty object if none).
        "metadata": _loads(c.config_metadata, {}),
        "created_at": c.created_at.isoformat(),
    }


def inference_out(i: Inference) -> dict[str, Any]:
    return {
        "id": i.id,
        "checkpoint_id": i.checkpoint_id,
        "experiment_id": i.experiment_id,
        "name": i.name,
        "params": _loads(i.params, {}),
        "command": i.command,
        "workdir": i.workdir,
        "status": i.status,
        "output_dir": i.output_dir,
        "log": i.log,
        "created_at": i.created_at.isoformat(),
    }


def evaluation_out(ev: Evaluation) -> dict[str, Any]:
    return {
        "id": ev.id,
        "project_id": ev.project_id,
        "inference_a_id": ev.inference_a_id,
        "inference_b_id": ev.inference_b_id,
        "status": ev.status,
        "result": _loads(ev.result, {}),
        "error": ev.error,
        "created_at": ev.created_at.isoformat(),
    }


def server_out(s: ServerConfig) -> dict[str, Any]:
    return {
        "id": s.id,
        "name": s.name,
        "host": s.host,
        "default_path": s.default_path,
        "description": s.description,
        # Never return the raw password; expose only whether one is configured.
        "password_set": bool(s.password),
        "created_at": s.created_at.isoformat(),
    }


def vlm_preset_out(p: VlmPreset) -> dict[str, Any]:
    return {
        "id": p.id,
        "name": p.name,
        "base_url": p.base_url,
        "model": p.model,
        # Never return the raw key; expose only whether one is configured.
        "api_key_set": bool(p.api_key),
        "created_at": p.created_at.isoformat(),
    }


def inference_engine_out(e: InferenceEngine) -> dict[str, Any]:
    return {
        "id": e.id,
        "name": e.name,
        "command": e.command,
        "workdir": e.workdir,
        "params": _loads(e.params, {}),
        "created_at": e.created_at.isoformat(),
    }
