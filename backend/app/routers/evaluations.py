"""Evaluation endpoints: create a VLM comparison of two inferences and read results."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlmodel import Session, select

from .. import jobs
from ..db import get_session
from ..models import Evaluation, Experiment, Inference, Project
from ..schemas import EvaluationCreate
from ..serializers import evaluation_out
from ..services import vlm_service

router = APIRouter(prefix="/api", tags=["evaluations"])


def _validate_inference(
    session: Session, inference_id: int, project_id: int
) -> Inference:
    inference = session.get(Inference, inference_id)
    if inference is None:
        raise HTTPException(404, "inference not found")
    experiment = session.get(Experiment, inference.experiment_id)
    if experiment is None or experiment.project_id != project_id:
        raise HTTPException(400, "inference does not belong to project")
    if inference.status != "done":
        raise HTTPException(409, "inference not complete")
    return inference


@router.post("/evaluations", status_code=201)
def create_evaluation(
    body: EvaluationCreate, session: Session = Depends(get_session)
) -> dict:
    project = session.get(Project, body.project_id)
    if project is None:
        raise HTTPException(404, "project not found")

    _validate_inference(session, body.inference_a_id, body.project_id)
    _validate_inference(session, body.inference_b_id, body.project_id)

    evaluation = Evaluation(
        project_id=body.project_id,
        inference_a_id=body.inference_a_id,
        inference_b_id=body.inference_b_id,
        status="running",
    )
    session.add(evaluation)
    session.commit()
    session.refresh(evaluation)

    jobs.submit(vlm_service.run_evaluation, evaluation.id)
    return evaluation_out(evaluation)


@router.get("/evaluations/{evaluation_id}")
def get_evaluation(
    evaluation_id: int, session: Session = Depends(get_session)
) -> dict:
    evaluation = session.get(Evaluation, evaluation_id)
    if evaluation is None:
        raise HTTPException(404, "evaluation not found")
    return evaluation_out(evaluation)


@router.get("/projects/{project_id}/evaluations")
def list_project_evaluations(
    project_id: int, session: Session = Depends(get_session)
) -> list[dict]:
    evaluations = session.exec(
        select(Evaluation)
        .where(Evaluation.project_id == project_id)
        .order_by(Evaluation.id.desc())
    ).all()
    return [evaluation_out(ev) for ev in evaluations]


@router.get("/evaluations")
def find_evaluation(
    a: int, b: int, session: Session = Depends(get_session)
) -> dict:
    evaluation = session.exec(
        select(Evaluation)
        .where(
            or_(
                (Evaluation.inference_a_id == a) & (Evaluation.inference_b_id == b),
                (Evaluation.inference_a_id == b) & (Evaluation.inference_b_id == a),
            )
        )
        .order_by(Evaluation.id.desc())
    ).first()
    if evaluation is None:
        raise HTTPException(404, "evaluation not found")
    return evaluation_out(evaluation)
