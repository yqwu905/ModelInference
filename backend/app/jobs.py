"""Lightweight background job runner.

Checkpoint copies and inference runs are long-lived blocking operations
(rsync, subprocess). We run them on a shared thread pool so the HTTP request
returns immediately with a ``copying`` / ``running`` status that the frontend
polls. Each job opens its own DB session via ``app.db.session_scope``.

The executor is created lazily and recreated after ``shutdown()``, so a second
application lifecycle in the same process (a reload, or a test that starts the
app twice) can still schedule jobs.
"""
from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

logger = logging.getLogger("modelinference.jobs")

_lock = threading.Lock()
_executor: Optional[ThreadPoolExecutor] = None


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="mi-job")
        return _executor


def submit(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
    """Run ``fn(*args, **kwargs)`` on the background pool, logging failures."""

    def _wrapped() -> None:
        try:
            fn(*args, **kwargs)
        except Exception:  # noqa: BLE001 - last-resort guard for background work
            logger.exception("Background job %s failed", getattr(fn, "__name__", fn))

    _get_executor().submit(_wrapped)


def shutdown() -> None:
    global _executor
    with _lock:
        ex, _executor = _executor, None
    if ex is not None:
        ex.shutdown(wait=False, cancel_futures=False)
