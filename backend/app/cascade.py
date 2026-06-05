"""Centralised cascade-delete + on-disk cleanup helpers.

Deleting any node in the Project -> Experiment -> Checkpoint -> Inference
hierarchy must also delete its descendants, any Evaluations that reference a
removed Inference, and the corresponding files on disk.

Each helper performs ``session.delete(...)`` for the rows it removes but does
NOT commit — the calling router commits once after invoking the helper.
"""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Optional

from sqlalchemy import or_
from sqlmodel import Session, select

from .models import Checkpoint, Evaluation, Experiment, Inference, Project


def remove_path(path: Optional[str]) -> None:
    """Recursively delete a directory/file if it exists. Never raises."""
    if not path:
        return
    p = Path(path)
    if p.exists():
        shutil.rmtree(p, ignore_errors=True)


def delete_inference_row(session: Session, inference: Inference) -> None:
    evals = session.exec(
        select(Evaluation).where(
            or_(
                Evaluation.inference_a_id == inference.id,
                Evaluation.inference_b_id == inference.id,
            )
        )
    ).all()
    for ev in evals:
        session.delete(ev)
    remove_path(inference.output_dir)
    session.delete(inference)


def delete_checkpoint_row(session: Session, checkpoint: Checkpoint) -> None:
    infs = session.exec(
        select(Inference).where(Inference.checkpoint_id == checkpoint.id)
    ).all()
    for inf in infs:
        delete_inference_row(session, inf)
    remove_path(checkpoint.local_path)
    session.delete(checkpoint)


def delete_experiment_row(session: Session, experiment: Experiment) -> None:
    cks = session.exec(
        select(Checkpoint).where(Checkpoint.experiment_id == experiment.id)
    ).all()
    for ck in cks:
        delete_checkpoint_row(session, ck)
    # Safety net for any inference tied to the experiment without a live checkpoint.
    orphans = session.exec(
        select(Inference).where(Inference.experiment_id == experiment.id)
    ).all()
    for inf in orphans:
        delete_inference_row(session, inf)
    session.delete(experiment)


def delete_project_row(session: Session, project: Project) -> None:
    exps = session.exec(
        select(Experiment).where(Experiment.project_id == project.id)
    ).all()
    for exp in exps:
        delete_experiment_row(session, exp)
    evals = session.exec(
        select(Evaluation).where(Evaluation.project_id == project.id)
    ).all()
    for ev in evals:
        session.delete(ev)
    session.delete(project)
