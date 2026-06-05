"""Experiment endpoints.

Experiments live under a project and group together checkpoints/inferences.
The ``hyperparameters`` JSON object is stored as a TEXT column holding a JSON
string; routers (de)serialise it via ``json.dumps`` on the way in and the
serializer parses it on the way out.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import cascade, serializers
from ..db import get_session
from ..models import Experiment, Project
from ..schemas import ExperimentCreate, ExperimentUpdate

router = APIRouter(prefix="/api", tags=["experiments"])


@router.get("/projects/{project_id}/experiments")
def list_experiments(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    experiments = session.exec(
        select(Experiment)
        .where(Experiment.project_id == project_id)
        .order_by(Experiment.id.desc())
    ).all()
    return [serializers.experiment_out(e) for e in experiments]


@router.post("/projects/{project_id}/experiments", status_code=201)
def create_experiment(
    project_id: int,
    body: ExperimentCreate,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    experiment = Experiment(
        project_id=project_id,
        name=body.name,
        description=body.description,
        hyperparameters=json.dumps(body.hyperparameters),
    )
    session.add(experiment)
    session.commit()
    session.refresh(experiment)
    return serializers.experiment_out(experiment)


@router.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: int, session: Session = Depends(get_session)):
    experiment = session.get(Experiment, experiment_id)
    if experiment is None:
        raise HTTPException(404, "experiment not found")
    return serializers.experiment_out(experiment)


@router.put("/experiments/{experiment_id}")
def update_experiment(
    experiment_id: int,
    body: ExperimentUpdate,
    session: Session = Depends(get_session),
):
    experiment = session.get(Experiment, experiment_id)
    if experiment is None:
        raise HTTPException(404, "experiment not found")
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key == "hyperparameters":
            setattr(experiment, key, json.dumps(value))
        else:
            setattr(experiment, key, value)
    session.add(experiment)
    session.commit()
    session.refresh(experiment)
    return serializers.experiment_out(experiment)


@router.delete("/experiments/{experiment_id}", status_code=204)
def delete_experiment(experiment_id: int, session: Session = Depends(get_session)):
    experiment = session.get(Experiment, experiment_id)
    if experiment is None:
        raise HTTPException(404, "experiment not found")
    cascade.delete_experiment_row(session, experiment)
    session.commit()
    return None
