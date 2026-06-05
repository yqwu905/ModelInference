import { useState } from "react";
import { api } from "../api";
import type { Checkpoint } from "../types";
import { useAsync, usePolling } from "../hooks";
import {
  ConfirmButton,
  ErrorBanner,
  Modal,
  Spinner,
  StatusBadge,
  formatBytes,
} from "./ui";

const DELETE_MESSAGE =
  "Delete this checkpoint? This permanently removes its copied files and any inferences that depend on it.";

function sourceLabel(c: Checkpoint): string {
  return `${c.source_host ? `${c.source_host}:` : ""}${c.source_path}`;
}

function CopyCheckpointModal({
  open,
  experimentId,
  onClose,
  onCreated,
}: {
  open: boolean;
  experimentId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [sourceHost, setSourceHost] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDisplayName("");
    setSourceHost("");
    setSourcePath("");
    setError(null);
    setSaving(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !sourcePath.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.createCheckpoint(experimentId, {
        display_name: displayName.trim(),
        source_host: sourceHost.trim(),
        source_path: sourcePath.trim(),
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Copy checkpoint">
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <div className="field">
          <label htmlFor="ckpt-name">Display name</label>
          <input
            id="ckpt-name"
            value={displayName}
            autoFocus
            required
            placeholder="epoch-50"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ckpt-host">
            SSH host (user@host) — leave blank to copy from a local path
          </label>
          <input
            id="ckpt-host"
            value={sourceHost}
            placeholder="user@gpu-box"
            onChange={(e) => setSourceHost(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ckpt-path">Source path</label>
          <input
            id="ckpt-path"
            value={sourcePath}
            required
            placeholder="/data/checkpoints/run1"
            className="mono"
            onChange={(e) => setSourcePath(e.target.value)}
          />
        </div>
        <div className="btn-row spread">
          <button type="button" className="btn-sm" onClick={close} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || !displayName.trim() || !sourcePath.trim()}
          >
            {saving ? "Starting copy…" : "Copy checkpoint"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RenameCheckpointModal({
  checkpoint,
  onClose,
  onRenamed,
}: {
  checkpoint: Checkpoint | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(checkpoint?.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkpoint || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateCheckpoint(checkpoint.id, name.trim());
      onRenamed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={!!checkpoint} onClose={onClose} title="Rename checkpoint">
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <div className="field">
          <label htmlFor="ckpt-rename">Display name</label>
          <input
            id="ckpt-rename"
            value={name}
            autoFocus
            required
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="btn-row spread">
          <button type="button" className="btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MetadataSection({ metadata }: { metadata: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(metadata ?? {});
  if (entries.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn-sm" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide config.yaml" : `config.yaml (${entries.length} keys)`}
      </button>
      {open && (
        <div className="kv" style={{ marginTop: 8 }}>
          {entries.map(([k, v]) => (
            <span style={{ display: "contents" }} key={k}>
              <span className="k">{k}</span>
              <span className="mono">
                {typeof v === "string" ? v : JSON.stringify(v)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CheckpointPanel({ experimentId }: { experimentId: number }) {
  const { data, loading, error, reload } = useAsync(
    () => api.listCheckpoints(experimentId),
    [experimentId],
  );
  const [copyOpen, setCopyOpen] = useState(false);
  const [renaming, setRenaming] = useState<Checkpoint | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasActive = !!data?.some(
    (c) => c.status === "pending" || c.status === "copying",
  );
  usePolling(reload, hasActive, 2000);

  const handleRecopy = async (id: number) => {
    setActionError(null);
    try {
      await api.recopyCheckpoint(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: number) => {
    setActionError(null);
    try {
      await api.deleteCheckpoint(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section style={{ marginTop: 24 }}>
      <div className="toolbar spread">
        <h2>Checkpoints</h2>
        <button className="btn-primary" onClick={() => setCopyOpen(true)}>
          + Copy checkpoint
        </button>
      </div>

      <ErrorBanner error={error ?? actionError} />

      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <div className="empty">No checkpoints yet. Copy one to get started.</div>
      ) : (
        <div className="col">
          {data.map((c) => (
            <div className="card" key={c.id}>
              <div className="spread">
                <h3>{c.display_name}</h3>
                <StatusBadge status={c.status} />
              </div>
              <div className="kv" style={{ marginTop: 8 }}>
                <span className="k">Source</span>
                <span className="mono">{sourceLabel(c)}</span>
                <span className="k">Size</span>
                <span>{formatBytes(c.size_bytes)}</span>
              </div>
              {c.message && (
                <p className="muted small" style={{ marginTop: 8 }}>
                  {c.message}
                </p>
              )}
              <MetadataSection metadata={c.metadata} />
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn-sm" onClick={() => setRenaming(c)}>
                  Rename
                </button>
                {(c.status === "failed" || c.status === "ready") && (
                  <button className="btn-sm" onClick={() => handleRecopy(c.id)}>
                    Recopy
                  </button>
                )}
                <ConfirmButton message={DELETE_MESSAGE} onConfirm={() => handleDelete(c.id)}>
                  Delete
                </ConfirmButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <CopyCheckpointModal
        open={copyOpen}
        experimentId={experimentId}
        onClose={() => setCopyOpen(false)}
        onCreated={() => {
          setCopyOpen(false);
          void reload();
        }}
      />
      <RenameCheckpointModal
        key={renaming?.id ?? "none"}
        checkpoint={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={() => {
          setRenaming(null);
          void reload();
        }}
      />
    </section>
  );
}
