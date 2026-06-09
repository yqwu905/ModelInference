"""Inference run execution (background job).

Builds a shell command from the inference's snapshotted ``command`` template
(taken from the chosen InferenceEngine at creation; falls back to the project's
legacy ``inference_command``) via safe substitution (unknown ``{tokens}`` are
left intact), runs it, and records stdout/stderr plus the terminal status on the
Inference row.
"""
from __future__ import annotations

import json
import re
import subprocess
import traceback
from pathlib import Path

from .. import db
from ..models import Checkpoint, Experiment, Inference, Project

_TOKEN_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _render(template: str, mapping: dict) -> str:
    """Substitute only known ``{identifier}`` tokens.

    Unknown ``{tokens}`` are left intact, and any other brace content (shell
    brace expansion like ``{,.bak}`` or ``{1..10}``, positional ``{0}``,
    ``${VAR}``) is passed through verbatim — unlike ``str.format_map``, which
    would choke on those.
    """
    return _TOKEN_RE.sub(
        lambda m: str(mapping[m.group(1)]) if m.group(1) in mapping else m.group(0),
        template,
    )


def run_inference(inference_id: int) -> None:
    with db.session_scope() as s:
        inference = s.get(Inference, inference_id)
        if inference is None:
            return
        checkpoint = s.get(Checkpoint, inference.checkpoint_id)
        experiment = s.get(Experiment, inference.experiment_id)
        project = s.get(Project, experiment.project_id) if experiment else None

        inference.status = "running"
        s.add(inference)
        s.commit()

        try:
            params = json.loads(inference.params or "{}")
            subst = {
                **params,
                "checkpoint": checkpoint.local_path if checkpoint else "",
                "output_dir": inference.output_dir,
            }
            # Prefer the engine snapshot taken at creation; fall back to the
            # project's legacy config for inferences created before engines.
            template = inference.command or (
                project.inference_command if project else ""
            )
            command = _render(template, subst)

            Path(inference.output_dir).mkdir(parents=True, exist_ok=True)
            workdir = (
                inference.workdir
                or (project.inference_workdir if project else "")
                or None
            )

            result = subprocess.run(
                command,
                shell=True,
                cwd=workdir,
                capture_output=True,
                text=True,
                timeout=1800,
            )
            inference.log = (
                f"$ {command}"
                + chr(10)
                + chr(10)
                + (result.stdout or "")
                + chr(10)
                + (result.stderr or "")
            )[:20000]
            inference.status = "done" if result.returncode == 0 else "failed"
            s.add(inference)
            s.commit()
        except Exception:  # noqa: BLE001 - record any failure on the row
            inference.status = "failed"
            inference.log = ((inference.log or "") + chr(10) + traceback.format_exc())[:20000]
            s.add(inference)
            s.commit()
