"""VLM-based pairwise evaluation of two inference image groups.

``run_evaluation`` runs on the background job pool: it gathers up to a handful
of images from each of two inferences, base64-encodes them as data URIs, builds
an OpenAI-compatible chat-completions request against the project's configured
VLM endpoint, and stores the parsed verdict on the Evaluation row.
"""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import httpx

from .. import db
from ..models import Evaluation, Inference, Project

# Only formats we can label with a correct MIME are sent to the VLM. Keying the
# gather filter off this map (rather than the broader config.IMAGE_EXTENSIONS)
# guarantees the declared MIME always matches the actual bytes.
_MIME_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
}

# Matches a fenced code block, with or without a language hint, whether the body
# is on its own line(s) or inline on the opening fence line.
_FENCE_CLOSED_RE = re.compile(
    r"^```[ \t]*[A-Za-z0-9_-]*[ \t]*\n?(.*?)\n?[ \t]*```\s*$", re.DOTALL
)
_FENCE_OPEN_RE = re.compile(r"^```[ \t]*[A-Za-z0-9_-]*[ \t]*\n?")


def _strip_code_fence(text: str) -> str:
    """Remove a surrounding markdown code fence if present."""
    s = text.strip()
    if not s.startswith("```"):
        return s
    m = _FENCE_CLOSED_RE.match(s)
    if m:
        return m.group(1).strip()
    # Opening fence with no closing fence: drop the fence token + language hint.
    return _FENCE_OPEN_RE.sub("", s, count=1).strip()


def _gather_images(output_dir: str, cap: int = 6) -> list[str]:
    """Return up to ``cap`` images from ``output_dir`` as base64 data URIs."""
    if not output_dir:
        return []
    d = Path(output_dir)
    if not d.is_dir():
        return []
    files = sorted(
        p
        for p in d.iterdir()
        if p.is_file() and p.suffix.lower() in _MIME_BY_SUFFIX
    )
    uris: list[str] = []
    for p in files[:cap]:
        mime = _MIME_BY_SUFFIX[p.suffix.lower()]  # guaranteed present by the filter
        b64 = base64.b64encode(p.read_bytes()).decode("ascii")
        uris.append(f"data:{mime};base64,{b64}")
    return uris


def run_evaluation(evaluation_id: int) -> None:
    """Evaluate the two inferences referenced by an Evaluation via the VLM."""
    with db.session_scope() as s:
        evaluation = s.get(Evaluation, evaluation_id)
        if evaluation is None:
            return
        project = s.get(Project, evaluation.project_id)
        inference_a = s.get(Inference, evaluation.inference_a_id)
        inference_b = s.get(Inference, evaluation.inference_b_id)

        evaluation.status = "running"
        s.add(evaluation)
        s.commit()

        if project is None or not project.vlm_base_url or not project.vlm_model:
            evaluation.status = "failed"
            evaluation.error = (
                "VLM not configured (set base URL and model in project settings)"
            )
            s.add(evaluation)
            s.commit()
            return

        imgs_a = _gather_images(inference_a.output_dir) if inference_a else []
        imgs_b = _gather_images(inference_b.output_dir) if inference_b else []

        content: list[dict] = [
            {
                "type": "text",
                "text": project.eval_prompt + chr(10) + chr(10) + "Group A images follow:",
            }
        ]
        for a in imgs_a:
            content.append({"type": "image_url", "image_url": {"url": a}})
        content.append({"type": "text", "text": "Group B images follow:"})
        for b in imgs_b:
            content.append({"type": "image_url", "image_url": {"url": b}})

        messages = [{"role": "user", "content": content}]
        payload = {
            "model": project.vlm_model,
            "messages": messages,
            "temperature": 0,
            "max_tokens": 800,
        }
        url = project.vlm_base_url.rstrip("/") + "/chat/completions"
        headers = {"Content-Type": "application/json"}
        if project.vlm_api_key:
            headers["Authorization"] = f"Bearer {project.vlm_api_key}"

        try:
            with httpx.Client(timeout=120) as client:
                r = client.post(url, json=payload, headers=headers)
                r.raise_for_status()
                data = r.json()
            text = data["choices"][0]["message"]["content"]

            stripped = _strip_code_fence(text)

            try:
                parsed = json.loads(stripped)
                result = {
                    "winner": parsed.get("winner"),
                    "score_a": parsed.get("score_a"),
                    "score_b": parsed.get("score_b"),
                    "reason": parsed.get("reason"),
                    "raw": text,
                }
            except (ValueError, TypeError, AttributeError):
                result = {"reason": text, "raw": text}

            evaluation.result = json.dumps(result)
            evaluation.status = "done"
            evaluation.error = ""
        except Exception as e:  # noqa: BLE001 - report any failure to the user
            evaluation.status = "failed"
            evaluation.error = str(e)[:2000]

        s.add(evaluation)
        s.commit()
