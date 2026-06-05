"""Project CRUD endpoints.

Projects are the top of the Project -> Experiment -> Checkpoint -> Inference
hierarchy and hold the inference-engine and VLM-evaluation configuration.
JSON-shaped fields (the inference parameter schema) are persisted as JSON
strings; the VLM api key is write-only (never echoed back).
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import cascade, config
from ..db import get_session
from ..models import Project
from ..schemas import ProjectCreate, ProjectUpdate
from ..serializers import project_out

router = APIRouter(prefix="/api", tags=["projects"])


@router.get("/projects")
def list_projects(session: Session = Depends(get_session)):
    projects = session.exec(select(Project).order_by(Project.id.desc())).all()
    return [project_out(p) for p in projects]


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreate, session: Session = Depends(get_session)):
    schema = (
        body.inference_param_schema
        if body.inference_param_schema is not None
        else config.DEFAULT_INFERENCE_PARAM_SCHEMA
    )
    project = Project(
        name=body.name,
        description=body.description,
        inference_command=(
            body.inference_command
            if body.inference_command is not None
            else config.DEFAULT_INFERENCE_COMMAND
        ),
        inference_workdir=(
            body.inference_workdir if body.inference_workdir is not None else ""
        ),
        inference_param_schema=json.dumps(schema),
        vlm_base_url=body.vlm_base_url if body.vlm_base_url is not None else "",
        vlm_api_key=body.vlm_api_key if body.vlm_api_key is not None else "",
        vlm_model=body.vlm_model if body.vlm_model is not None else "",
        eval_prompt=(
            body.eval_prompt
            if body.eval_prompt is not None
            else config.DEFAULT_EVAL_PROMPT
        ),
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project_out(project)


@router.get("/projects/{project_id}")
def get_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    return project_out(project)


@router.put("/projects/{project_id}")
def update_project(
    project_id: int,
    body: ProjectUpdate,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")

    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        # None is never a legal value for these NOT NULL columns (strings are
        # cleared with "", the param schema is always an array). Skip explicit
        # nulls so a malformed PUT is a no-op rather than a 500 / corrupted row.
        if value is None:
            continue
        if key == "inference_param_schema":
            setattr(project, key, json.dumps(value))
        else:
            setattr(project, key, value)

    session.add(project)
    session.commit()
    session.refresh(project)
    return project_out(project)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    cascade.delete_project_row(session, project)
    session.commit()
    return None
