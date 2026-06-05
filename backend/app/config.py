"""Application configuration and filesystem layout.

All runtime artifacts (SQLite DB, copied checkpoints, inference output images)
live under a single data directory, configurable via the ``MI_DATA_DIR``
environment variable. Defaults to ``<backend>/data``.
"""
from __future__ import annotations

import os
from pathlib import Path

# backend/app/config.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent

DATA_DIR = Path(os.environ.get("MI_DATA_DIR", BACKEND_DIR / "data")).resolve()
CHECKPOINTS_DIR = DATA_DIR / "checkpoints"
INFERENCES_DIR = DATA_DIR / "inferences"
DB_PATH = DATA_DIR / "modelinference.db"

SCRIPTS_DIR = BACKEND_DIR / "scripts"
MOCK_INFERENCE_SCRIPT = SCRIPTS_DIR / "mock_inference.py"

# Default inference command template prefilled on new projects so the pipeline
# works end-to-end out of the box. Tokens {checkpoint} and {output_dir} are
# always substituted; remaining {tokens} are filled from inference parameters.
DEFAULT_INFERENCE_COMMAND = (
    f'python "{MOCK_INFERENCE_SCRIPT}" '
    '--ckpt "{checkpoint}" --out "{output_dir}" '
    '--prompt "{prompt}" --count {count} --seed {seed}'
)

# Default parameter schema used to render the "run inference" form.
DEFAULT_INFERENCE_PARAM_SCHEMA = [
    {"name": "prompt", "label": "Prompt", "type": "text", "default": "a scenic mountain landscape at sunset"},
    {"name": "count", "label": "Image count", "type": "number", "default": 4},
    {"name": "seed", "label": "Seed", "type": "number", "default": 42},
]

DEFAULT_EVAL_PROMPT = (
    "You are an expert visual judge. You are shown two groups of AI-generated "
    "images: Group A and Group B. Evaluate which group is better overall, "
    "considering image quality, prompt adherence, composition, and aesthetics.\n\n"
    "Respond with ONLY a JSON object, no markdown fences, in exactly this shape:\n"
    '{"winner": "A" | "B" | "tie", "score_a": <0-10>, "score_b": <0-10>, '
    '"reason": "<concise explanation>"}'
)

# Image file extensions recognised when scanning inference output directories.
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}


def ensure_dirs() -> None:
    """Create the data directory tree if it does not yet exist."""
    for d in (DATA_DIR, CHECKPOINTS_DIR, INFERENCES_DIR):
        d.mkdir(parents=True, exist_ok=True)
