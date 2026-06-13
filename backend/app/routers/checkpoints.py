"""Checkpoint endpoints.

Checkpoints are copied (local or over ssh) into a per-checkpoint directory under
``config.CHECKPOINTS_DIR``. Creation and recopy launch the copy on the shared
background pool and return immediately with a ``copying`` status for the
frontend to poll.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import cascade, config, jobs
from ..db import get_session
from ..models import Checkpoint, Experiment
from ..schemas import CheckpointCreate, CheckpointUpdate
from ..serializers import checkpoint_out
from ..services import copy_service

router = APIRouter(prefix="/api", tags=["checkpoints"])


@router.get("/experiments/{experiment_id}/checkpoints")
def list_checkpoints(
    experiment_id: int, session: Session = Depends(get_session)
) -> list[dict]:
    checkpoints = session.exec(
        select(Checkpoint)
        .where(Checkpoint.experiment_id == experiment_id)
        .order_by(Checkpoint.id.desc())
    ).all()
    return [checkpoint_out(c) for c in checkpoints]


@router.post(
    "/experiments/{experiment_id}/checkpoints", status_code=201
)
def create_checkpoint(
    experiment_id: int,
    body: CheckpointCreate,
    session: Session = Depends(get_session),
) -> dict:
    experiment = session.get(Experiment, experiment_id)
    if experiment is None:
        raise HTTPException(404, "experiment not found")

    checkpoint = Checkpoint(
        experiment_id=experiment_id,
        display_name=body.display_name,
        source_host=body.source_host,
        source_path=body.source_path,
        status="copying",
    )
    session.add(checkpoint)
    session.commit()
    session.refresh(checkpoint)

    checkpoint.local_path = str(config.CHECKPOINTS_DIR / str(checkpoint.id))
    session.add(checkpoint)
    session.commit()
    session.refresh(checkpoint)

    jobs.submit(copy_service.copy_checkpoint, checkpoint.id)
    return checkpoint_out(checkpoint)


@router.get("/checkpoints/{checkpoint_id}")
def get_checkpoint(
    checkpoint_id: int, session: Session = Depends(get_session)
) -> dict:
    checkpoint = session.get(Checkpoint, checkpoint_id)
    if checkpoint is None:
        raise HTTPException(404, "checkpoint not found")
    return checkpoint_out(checkpoint)


@router.put("/checkpoints/{checkpoint_id}")
def update_checkpoint(
    checkpoint_id: int,
    body: CheckpointUpdate,
    session: Session = Depends(get_session),
) -> dict:
    checkpoint = session.get(Checkpoint, checkpoint_id)
    if checkpoint is None:
        raise HTTPException(404, "checkpoint not found")
    checkpoint.display_name = body.display_name
    session.add(checkpoint)
    session.commit()
    session.refresh(checkpoint)
    return checkpoint_out(checkpoint)


@router.delete("/checkpoints/{checkpoint_id}", status_code=204)
def delete_checkpoint(
    checkpoint_id: int, session: Session = Depends(get_session)
) -> None:
    checkpoint = session.get(Checkpoint, checkpoint_id)
    if checkpoint is None:
        raise HTTPException(404, "checkpoint not found")
    cascade.delete_checkpoint_row(session, checkpoint)
    session.commit()
    return None


@router.post("/checkpoints/{checkpoint_id}/recopy")
def recopy_checkpoint(
    checkpoint_id: int, session: Session = Depends(get_session)
) -> dict:
    checkpoint = session.get(Checkpoint, checkpoint_id)
    if checkpoint is None:
        raise HTTPException(404, "checkpoint not found")
    checkpoint.status = "copying"
    checkpoint.message = ""
    checkpoint.progress = 0
    session.add(checkpoint)
    session.commit()
    session.refresh(checkpoint)

    jobs.submit(copy_service.copy_checkpoint, checkpoint.id)
    return checkpoint_out(checkpoint)
