"""Request bodies for the API (Pydantic models).

Responses are produced by ``app.serializers`` as plain dicts, so only inbound
payloads are modelled here. Optional fields default to ``None`` so that PATCH-
style partial updates only touch provided keys.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


# ---- Project ----
class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    inference_command: Optional[str] = None
    inference_workdir: Optional[str] = None
    inference_param_schema: Optional[list[dict[str, Any]]] = None
    vlm_base_url: Optional[str] = None
    vlm_api_key: Optional[str] = None
    vlm_model: Optional[str] = None
    eval_prompt: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    inference_command: Optional[str] = None
    inference_workdir: Optional[str] = None
    inference_param_schema: Optional[list[dict[str, Any]]] = None
    # Nullable on purpose: an explicit null clears the project's default engine.
    default_engine_id: Optional[int] = None
    vlm_base_url: Optional[str] = None
    vlm_api_key: Optional[str] = None
    vlm_model: Optional[str] = None
    eval_prompt: Optional[str] = None


# ---- Experiment ----
class ExperimentCreate(BaseModel):
    name: str
    description: str = ""
    hyperparameters: dict[str, Any] = {}


class ExperimentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    hyperparameters: Optional[dict[str, Any]] = None


# ---- Checkpoint ----
class CheckpointCreate(BaseModel):
    display_name: str
    source_host: str = ""      # empty => copy from a local path
    source_path: str


class CheckpointUpdate(BaseModel):
    # Renaming only affects the display name, never the on-disk files.
    display_name: str


# ---- Inference ----
class InferenceCreate(BaseModel):
    name: str
    params: dict[str, Any] = {}
    # Global inference engine to run with; its command/workdir are snapshotted
    # onto the inference. Omitted => fall back to the project's legacy config.
    engine_id: Optional[int] = None


class InferenceUpdate(BaseModel):
    name: str


# ---- Evaluation ----
class EvaluationCreate(BaseModel):
    project_id: int
    inference_a_id: int
    inference_b_id: int


# ---- Settings: servers ----
class ServerCreate(BaseModel):
    name: str
    host: str = ""
    port: int = 22
    default_path: str = ""
    description: str = ""
    # ssh password (optional). Provided non-empty => set; omitted/None => none.
    password: Optional[str] = None


class ServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    default_path: Optional[str] = None
    description: Optional[str] = None
    # Provided non-empty => set; "" => clear; omitted => keep (handled in router).
    password: Optional[str] = None


# ---- Settings: VLM presets ----
class VlmPresetCreate(BaseModel):
    name: str
    base_url: str = ""
    model: str = ""
    api_key: Optional[str] = None


class VlmPresetUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    # Provided non-empty => set; "" => clear; omitted => keep (handled in router).
    api_key: Optional[str] = None


# ---- Settings: inference engines ----
class InferenceEngineCreate(BaseModel):
    name: str
    command: str = ""
    workdir: str = ""
    params: dict[str, Any] = {}


class InferenceEngineUpdate(BaseModel):
    name: Optional[str] = None
    command: Optional[str] = None
    workdir: Optional[str] = None
    params: Optional[dict[str, Any]] = None
