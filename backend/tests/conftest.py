"""Pytest fixtures — isolate all runtime artifacts under a temp data dir.

``MI_DATA_DIR`` must be set BEFORE ``app.config`` is imported, so we set it at
module import time (pytest imports conftest before collecting tests).
"""
from __future__ import annotations

import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="mi_test_")
os.environ["MI_DATA_DIR"] = _TMP
