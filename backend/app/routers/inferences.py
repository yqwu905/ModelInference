"""Inference endpoints: list/create per checkpoint or experiment, CRUD, images."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import cascade, config, jobs
from ..db import get_session
from ..models import Checkpoint, Inference, InferenceEngine, TestSet
from ..schemas import InferenceCreate, InferenceUpdate
from ..serializers import inference_out
from ..services import inference_service

router = APIRouter(prefix="/api", tags=["inferences"])


@router.get("/checkpoints/{checkpoint_id}/inferences")
def list_checkpoint_inferences(
    checkpoint_id: int, session: Session = Depends(get_session)
):
    rows = session.exec(
        select(Inference)
        .where(Inference.checkpoint_id == checkpoint_id)
        .order_by(Inference.id.desc())
    ).all()
    return [inference_out(i) for i in rows]


@router.get("/experiments/{experiment_id}/inferences")
def list_experiment_inferences(
    experiment_id: int, session: Session = Depends(get_session)
):
    rows = session.exec(
        select(Inference)
        .where(Inference.experiment_id == experiment_id)
        .order_by(Inference.id.desc())
    ).all()
    return [inference_out(i) for i in rows]


@router.post("/checkpoints/{checkpoint_id}/inferences", status_code=201)
def create_inference(
    checkpoint_id: int,
    body: InferenceCreate,
    session: Session = Depends(get_session),
):
    checkpoint = session.get(Checkpoint, checkpoint_id)
    if checkpoint is None:
        raise HTTPException(404, "checkpoint not found")
    if checkpoint.status != "ready":
        raise HTTPException(409, "checkpoint not ready")

    # Snapshot the chosen engine's command/workdir so the run is reproducible
    # even if the engine is later edited or deleted. Without an engine, the run
    # falls back to the project's legacy inference config.
    engine = None
    if body.engine_id is not None:
        engine = session.get(InferenceEngine, body.engine_id)
        if engine is None:
            raise HTTPException(404, "engine not found")

    # Resolve the optional test set and inject its folder path into the chosen
    # param key, so the path reaches the command line the same way other params
    # do (substituted via {key} or appended as --key value). Recording the id
    # also drives browse-time filtering and the reference-image column.
    params = dict(body.params)
    if body.test_set_id is not None:
        test_set = session.get(TestSet, body.test_set_id)
        if test_set is None:
            raise HTTPException(404, "test set not found")
        if body.test_set_param_key:
            params[body.test_set_param_key] = test_set.path

    inference = Inference(
        checkpoint_id=checkpoint_id,
        experiment_id=checkpoint.experiment_id,
        name=body.name,
        params=json.dumps(params),
        command=engine.command if engine else "",
        workdir=engine.workdir if engine else "",
        test_set_id=body.test_set_id,
        status="running",
    )
    session.add(inference)
    session.commit()
    session.refresh(inference)

    inference.output_dir = str(config.INFERENCES_DIR / str(inference.id))
    session.add(inference)
    session.commit()
    session.refresh(inference)

    jobs.submit(inference_service.run_inference, inference.id)
    return inference_out(inference)


@router.get("/inferences/{inference_id}")
def get_inference(inference_id: int, session: Session = Depends(get_session)):
    inference = session.get(Inference, inference_id)
    if inference is None:
        raise HTTPException(404, "inference not found")
    return inference_out(inference)


@router.put("/inferences/{inference_id}")
def update_inference(
    inference_id: int,
    body: InferenceUpdate,
    session: Session = Depends(get_session),
):
    inference = session.get(Inference, inference_id)
    if inference is None:
        raise HTTPException(404, "inference not found")
    inference.name = body.name
    session.add(inference)
    session.commit()
    session.refresh(inference)
    return inference_out(inference)


@router.delete("/inferences/{inference_id}", status_code=204)
def delete_inference(inference_id: int, session: Session = Depends(get_session)):
    inference = session.get(Inference, inference_id)
    if inference is None:
        raise HTTPException(404, "inference not found")
    cascade.delete_inference_row(session, inference)
    session.commit()
    return None


@router.get("/inferences/{inference_id}/images")
def list_inference_images(inference_id: int, session: Session = Depends(get_session)):
    inference = session.get(Inference, inference_id)
    if inference is None:
        raise HTTPException(404, "inference not found")

    if not inference.output_dir:
        return {"images": []}
    directory = Path(inference.output_dir)
    if not directory.is_dir():
        return {"images": []}

    files = sorted(
        (
            f
            for f in directory.iterdir()
            if f.is_file() and f.suffix.lower() in config.IMAGE_EXTENSIONS
        ),
        key=lambda f: f.name,
    )
    images = []
    for f in files:
        try:
            relative = f.resolve().relative_to(config.DATA_DIR)
        except ValueError:
            # Not under the current DATA_DIR (e.g. a stale output_dir from a
            # previous MI_DATA_DIR); it is not servable via /files, so skip it.
            continue
        images.append("/files/" + relative.as_posix())
    return {"images": images}
