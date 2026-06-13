"""Background checkpoint-copy worker.

Copies a checkpoint's source directory (local or over ssh) into its resolved
``local_path`` using rsync (preferred) or a scp/copytree fallback, updating the
row's status, size, and message as it goes. Runs on the shared job pool, so it
opens its own DB session via :func:`app.db.session_scope`.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import yaml
from sqlmodel import Session, select

from .. import db
from ..models import Checkpoint, ServerConfig

# Common single-file checkpoint extensions. Used only to guess file-vs-directory
# for REMOTE sources (which cannot be stat'd before transfer).
_FILE_SUFFIXES = {
    ".safetensors", ".ckpt", ".bin", ".pt", ".pth", ".gguf",
    ".onnx", ".h5", ".pkl", ".npz", ".zip", ".tar", ".gz",
}

# Config files recognised at the root of a directory checkpoint.
_CONFIG_NAMES = ("config.yaml", "config.yml")

# Hard caps. Config files are tiny; these bound work so a crafted config.yaml
# (whose bytes come from the copy source, not the operator) cannot exhaust
# memory or bloat the DB. safe_load does NOT limit YAML alias expansion, so we
# also reject aliases outright via a custom loader — the "billion laughs"
# vector — which checkpoint configs never legitimately need.
_CONFIG_MAX_FILE_BYTES = 1 * 1024 * 1024        # 1 MB on-disk cap
_CONFIG_MAX_SERIALIZED_BYTES = 1 * 1024 * 1024  # 1 MB serialized-output cap


class _NoAliasSafeLoader(yaml.SafeLoader):
    """SafeLoader that rejects YAML aliases (the alias/anchor expansion bomb)."""

    def compose_node(self, parent, index):  # type: ignore[override]
        if self.check_event(yaml.AliasEvent):
            raise yaml.YAMLError("YAML aliases are not allowed in config files")
        return super().compose_node(parent, index)


def _load_config_metadata(dst: str) -> dict:
    """Parse a ``config.yaml``/``config.yml`` at the root of ``dst``, if present.

    Returns the parsed mapping, or ``{}`` when there is no config file, it is
    too large, it cannot be read/parsed (including any use of YAML aliases), or
    its top level is not a mapping. The result is size-bounded; never raises.
    """
    base = Path(dst)
    for name in _CONFIG_NAMES:
        f = base / name
        if not f.is_file():
            continue
        try:
            if f.stat().st_size > _CONFIG_MAX_FILE_BYTES:
                return {}
            data = yaml.load(f.read_text(encoding="utf-8"), Loader=_NoAliasSafeLoader)
        except (yaml.YAMLError, OSError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        try:
            if len(json.dumps(data)) > _CONFIG_MAX_SERIALIZED_BYTES:
                return {}
        except (TypeError, ValueError):
            return {}
        return data
    return {}


def _server_for_host(session: Session, source_host: str) -> ServerConfig | None:
    """Return the most recent saved :class:`ServerConfig` matching ``source_host``.

    It supplies the ssh password and port for the copy. Returns ``None`` when no
    server is saved for the host (key auth, default port 22). The password lives
    only in that table — it is never copied onto the checkpoint row nor sent to
    the browser (the serializer redacts it). When several servers share a host,
    the most recently created one wins.
    """
    if not source_host:
        return None
    return session.exec(
        select(ServerConfig)
        .where(ServerConfig.host == source_host)
        .order_by(ServerConfig.id.desc())
    ).first()


def copy_checkpoint(checkpoint_id: int) -> None:
    """Copy a checkpoint's source into its local destination directory."""
    with db.session_scope() as s:
        checkpoint = s.get(Checkpoint, checkpoint_id)
        if checkpoint is None:
            return

        checkpoint.status = "copying"
        checkpoint.message = ""
        s.add(checkpoint)
        s.commit()

        source_host = (checkpoint.source_host or "").strip()
        source_path = checkpoint.source_path or ""
        dst = checkpoint.local_path

        # A saved server for this host (if any) supplies the ssh password and
        # port. A password switches ssh from key-only to password auth via
        # sshpass; a non-default port is passed to ssh/scp. Looked up now while
        # the session is open.
        server = _server_for_host(s, source_host)
        password = server.password if server else ""
        port = (server.port or 22) if server else 22

        status = "failed"
        size_bytes = checkpoint.size_bytes
        message = ""
        local_is_file = False
        config_metadata_json: str | None = None  # None => leave unchanged

        try:
            # Build the source spec: local path or user@host:path.
            if source_host:
                src = f"{source_host}:{source_path}"
            else:
                src = source_path

            # Ensure destination and its parent exist.
            dst_path = Path(dst)
            dst_path.mkdir(parents=True, exist_ok=True)

            # Trailing-slash semantics: for a DIRECTORY source, append "/" so
            # rsync/scp land its CONTENTS inside dst. For a single FILE source,
            # do NOT append "/" (that would make rsync/scp lstat a non-existent
            # directory); the file is then placed inside the dst directory.
            if source_host:
                # We can't stat a remote path, so guess file vs directory by
                # suffix: a remote single-file checkpoint must not get a "/".
                if Path(source_path).suffix.lower() in _FILE_SUFFIXES:
                    src = src.rstrip("/")
                elif not src.endswith("/"):
                    src = src + "/"
            else:
                local_is_file = Path(source_path).is_file()
                if local_is_file:
                    src = src.rstrip("/")
                elif not src.endswith("/"):
                    src = src + "/"

            # With a saved password we must NOT set BatchMode=yes (it disables
            # password auth); sshpass answers the prompt instead. Without one,
            # keep BatchMode=yes so a key-only host fails fast rather than
            # hanging on an interactive prompt. The password is passed to sshpass
            # via the SSHPASS env var (not argv), so it never lands in `ps`.
            env = None
            sshpass_prefix: list[str] = []
            if password:
                if not shutil.which("sshpass"):
                    raise RuntimeError(
                        "源服务器配置了密码，但服务器未安装 sshpass，无法进行密码认证。"
                        "请在服务器上安装 sshpass，或改用 SSH 密钥认证。"
                    )
                sshpass_prefix = ["sshpass", "-e"]
                env = {**os.environ, "SSHPASS": password}
            batch = "no" if password else "yes"
            ssh_transport = (
                f"ssh -o BatchMode={batch} -o StrictHostKeyChecking=accept-new"
            )
            # ssh defaults to 22; only spell out a non-default port (keeps the
            # command minimal and the default path identical to before).
            if port != 22:
                ssh_transport += f" -p {port}"

            result = None
            if shutil.which("rsync"):
                cmd = [*sshpass_prefix, "rsync", "-az", "--no-owner", "--no-group"]
                if source_host:
                    cmd += ["-e", ssh_transport]
                cmd += [src, dst]
                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=3600, env=env
                )
            elif source_host:
                cmd = [
                    *sshpass_prefix,
                    "scp",
                    "-r",
                    "-o",
                    f"BatchMode={batch}",
                    "-o",
                    "StrictHostKeyChecking=accept-new",
                ]
                if port != 22:
                    cmd += ["-P", str(port)]  # scp uses -P (capital) for the port
                cmd += [src, dst]
                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=3600, env=env
                )
            elif local_is_file:
                # Local single file without rsync: copy it into dst.
                shutil.copy2(source_path, Path(dst) / Path(source_path).name)
            else:
                # Local directory without rsync: copy its tree into dst.
                shutil.copytree(source_path.rstrip("/"), dst, dirs_exist_ok=True)

            if result is not None and result.returncode != 0:
                status = "failed"
                message = (
                    result.stderr
                    or result.stdout
                    or f"exit {result.returncode}"
                )[:2000]
            else:
                status = "ready"
                size_bytes = sum(
                    f.stat().st_size
                    for f in Path(dst).rglob("*")
                    if f.is_file()
                )
                message = ""
                # Pick up config.yaml metadata for directory checkpoints (a
                # single-file copy has no config file, yielding {}).
                config_metadata_json = json.dumps(_load_config_metadata(dst))
        except Exception as e:  # noqa: BLE001 - record failure on the row
            status = "failed"
            message = str(e)

        # Re-fetch inside the session before the final update.
        checkpoint = s.get(Checkpoint, checkpoint_id)
        if checkpoint is not None:
            checkpoint.status = status
            checkpoint.size_bytes = size_bytes
            checkpoint.message = message
            if config_metadata_json is not None:
                checkpoint.config_metadata = config_metadata_json
            s.add(checkpoint)
        s.commit()
