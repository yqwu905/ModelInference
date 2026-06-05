"""Database models (SQLModel tables).

JSON-shaped fields (hyperparameters, params, param schema, eval result) are
stored as TEXT columns holding JSON strings. Helper accessors live in
``app.serializers`` so routers can convert rows to API payloads.

The hierarchy is Project -> Experiment -> Checkpoint -> Inference, with
Evaluation comparing two Inferences within a Project.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: str = ""

    # Inference engine configuration.
    # Command template; {checkpoint} and {output_dir} are always substituted,
    # other {tokens} come from per-run inference parameters.
    inference_command: str = ""
    inference_workdir: str = ""
    # JSON list of {name,label,type,default,options?} param definitions.
    inference_param_schema: str = "[]"

    # VLM / evaluation configuration (any OpenAI-compatible chat API).
    vlm_base_url: str = ""
    vlm_api_key: str = ""
    vlm_model: str = ""
    eval_prompt: str = ""

    created_at: datetime = Field(default_factory=_utcnow)


class Experiment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    name: str
    description: str = ""
    # JSON object of training hyperparameters.
    hyperparameters: str = "{}"
    created_at: datetime = Field(default_factory=_utcnow)


class Checkpoint(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    experiment_id: int = Field(foreign_key="experiment.id", index=True)
    # Display name is independent of the on-disk filename.
    display_name: str
    source_host: str = ""          # ssh host (user@host or host); empty = local copy
    source_path: str = ""          # path on the remote/local source
    local_path: str = ""           # resolved local destination directory
    status: str = "pending"        # pending | copying | ready | failed
    size_bytes: int = 0
    message: str = ""              # progress / error detail
    # JSON of a parsed config.yaml found at the root of a directory checkpoint
    # (empty object when there is no such file). Named config_metadata because
    # "metadata" is reserved by SQLAlchemy; exposed as "metadata" in the API.
    config_metadata: str = "{}"
    created_at: datetime = Field(default_factory=_utcnow)


class Inference(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    checkpoint_id: int = Field(foreign_key="checkpoint.id", index=True)
    # Denormalised for convenient experiment-level listing / comparison.
    experiment_id: int = Field(foreign_key="experiment.id", index=True)
    name: str
    # JSON object of inference hyperparameters.
    params: str = "{}"
    status: str = "pending"        # pending | running | done | failed
    output_dir: str = ""
    log: str = ""
    created_at: datetime = Field(default_factory=_utcnow)


class Evaluation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    inference_a_id: int = Field(foreign_key="inference.id", index=True)
    inference_b_id: int = Field(foreign_key="inference.id", index=True)
    status: str = "pending"        # pending | running | done | failed
    # JSON object: {"winner","score_a","score_b","reason", "raw"?}
    result: str = "{}"
    error: str = ""
    created_at: datetime = Field(default_factory=_utcnow)
