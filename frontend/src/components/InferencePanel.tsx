import { useEffect, useState } from "react";
import { api } from "../api";
import type { Checkpoint, Inference, ParamDef, Project } from "../types";
import { useAsync, usePolling } from "../hooks";
import {
  ConfirmButton,
  ErrorBanner,
  Lightbox,
  Modal,
  Spinner,
  StatusBadge,
} from "./ui";

const DELETE_MESSAGE = "Delete this inference? This permanently removes its output images.";

function paramDefault(def: ParamDef): string {
  return String(def.default ?? "");
}

function ImagesModal({
  inference,
  onClose,
}: {
  inference: Inference | null;
  onClose: () => void;
}) {
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!inference) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setImages([]);
    api
      .getInferenceImages(inference.id)
      .then((res) => {
        if (!cancelled) setImages(res.images);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inference]);

  return (
    <Modal
      open={!!inference}
      onClose={onClose}
      wide
      title={inference ? `Images — ${inference.name}` : "Images"}
    >
      <ErrorBanner error={error} />
      {loading ? (
        <Spinner />
      ) : images.length === 0 ? (
        <div className="empty">No images yet</div>
      ) : (
        <div className="thumbs">
          {images.map((src) => (
            <img key={src} src={src} alt="" onClick={() => setLightbox(src)} />
          ))}
        </div>
      )}
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </Modal>
  );
}

function RenameInferenceModal({
  inference,
  onClose,
  onRenamed,
}: {
  inference: Inference | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(inference?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inference || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateInference(inference.id, name.trim());
      onRenamed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={!!inference} onClose={onClose} title="Rename inference">
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <div className="field">
          <label htmlFor="inf-rename">Name</label>
          <input
            id="inf-rename"
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

function RunInferenceModal({
  open,
  project,
  readyCheckpoints,
  defaultName,
  onClose,
  onCreated,
}: {
  open: boolean;
  project: Project;
  readyCheckpoints: Checkpoint[];
  defaultName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const schema = project.inference_param_schema;
  const [checkpointId, setCheckpointId] = useState<number | "">(
    readyCheckpoints[0]?.id ?? "",
  );
  const [name, setName] = useState(defaultName);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(schema.map((def) => [def.name, paramDefault(def)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkpointId === "" || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {};
      for (const def of schema) {
        if (def.type === "number") {
          // Omit a blank/invalid number rather than sending 0 (Number(""))
          // or null (Number("abc")); the backend then leaves its {token} intact.
          const trimmed = (values[def.name] ?? "").trim();
          if (trimmed === "") continue;
          const n = Number(trimmed);
          if (Number.isNaN(n)) continue;
          params[def.name] = n;
        } else {
          params[def.name] = values[def.name] ?? "";
        }
      }
      await api.createInference(checkpointId, { name: name.trim(), params });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Run inference">
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <div className="field">
          <label htmlFor="inf-checkpoint">Checkpoint</label>
          <select
            id="inf-checkpoint"
            value={checkpointId}
            required
            onChange={(e) => setCheckpointId(e.target.value ? Number(e.target.value) : "")}
          >
            {readyCheckpoints.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="inf-name">Name</label>
          <input
            id="inf-name"
            value={name}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {schema.map((def) => {
          const id = `inf-param-${def.name}`;
          const value = values[def.name] ?? "";
          const onChange = (v: string) =>
            setValues((prev) => ({ ...prev, [def.name]: v }));
          return (
            <div className="field" key={def.name}>
              <label htmlFor={id}>{def.label}</label>
              {def.type === "select" ? (
                <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
                  {(def.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : def.type === "number" ? (
                <input
                  id={id}
                  type="number"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                />
              ) : (
                <input
                  id={id}
                  type="text"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                />
              )}
            </div>
          );
        })}
        <div className="btn-row spread">
          <button type="button" className="btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || checkpointId === "" || !name.trim()}
          >
            {saving ? "Starting…" : "Run inference"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InferenceCard({
  inference,
  onViewImages,
  onRename,
  onDelete,
}: {
  inference: Inference;
  onViewImages: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [showLog, setShowLog] = useState(false);
  const entries = Object.entries(inference.params);
  return (
    <div className="card">
      <div className="spread">
        <h3>{inference.name}</h3>
        <StatusBadge status={inference.status} />
      </div>
      {entries.length > 0 && (
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
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn-sm" onClick={onViewImages}>
          View images
        </button>
        <button className="btn-sm" onClick={() => setShowLog((s) => !s)}>
          {showLog ? "Hide log" : "Log"}
        </button>
        <button className="btn-sm" onClick={onRename}>
          Rename
        </button>
        <ConfirmButton message={DELETE_MESSAGE} onConfirm={onDelete}>
          Delete
        </ConfirmButton>
      </div>
      {showLog && (
        <pre className="log" style={{ marginTop: 12 }}>
          {inference.log || "(no log output)"}
        </pre>
      )}
    </div>
  );
}

export default function InferencePanel({
  experimentId,
  project,
}: {
  experimentId: number;
  project: Project;
}) {
  const {
    data: inferences,
    loading: inferencesLoading,
    error: inferencesError,
    reload: reloadInferences,
  } = useAsync(() => api.listInferencesByExperiment(experimentId), [experimentId]);
  const {
    data: checkpoints,
    error: checkpointsError,
    reload: reloadCheckpoints,
  } = useAsync(() => api.listCheckpoints(experimentId), [experimentId]);

  const [runOpen, setRunOpen] = useState(false);
  const [viewing, setViewing] = useState<Inference | null>(null);
  const [renaming, setRenaming] = useState<Inference | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const anyRunning = !!inferences?.some(
    (i) => i.status === "running" || i.status === "pending",
  );
  usePolling(reloadInferences, anyRunning, 2000);

  const readyCheckpoints = (checkpoints ?? []).filter((c) => c.status === "ready");
  const canRun = readyCheckpoints.length > 0;

  const handleDelete = async (id: number) => {
    setActionError(null);
    try {
      await api.deleteInference(id);
      await reloadInferences();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const defaultName = `run-${(inferences?.length ?? 0) + 1}`;

  return (
    <section style={{ marginTop: 24 }}>
      <div className="toolbar spread">
        <h2>Inferences</h2>
        <button
          className="btn-primary"
          disabled={!canRun}
          onClick={() => {
            void reloadCheckpoints();
            setRunOpen(true);
          }}
        >
          + Run inference
        </button>
      </div>

      {!canRun && (
        <p className="muted small" style={{ marginTop: -8, marginBottom: 16 }}>
          Copy a checkpoint and wait for it to be ready before running an inference.
        </p>
      )}

      <ErrorBanner error={inferencesError ?? checkpointsError ?? actionError} />

      {inferencesLoading ? (
        <Spinner />
      ) : !inferences || inferences.length === 0 ? (
        <div className="empty">No inferences yet.</div>
      ) : (
        <div className="col">
          {inferences.map((inf) => (
            <InferenceCard
              key={inf.id}
              inference={inf}
              onViewImages={() => setViewing(inf)}
              onRename={() => setRenaming(inf)}
              onDelete={() => handleDelete(inf.id)}
            />
          ))}
        </div>
      )}

      {runOpen && (
        <RunInferenceModal
          open={runOpen}
          project={project}
          readyCheckpoints={readyCheckpoints}
          defaultName={defaultName}
          onClose={() => setRunOpen(false)}
          onCreated={() => {
            setRunOpen(false);
            void reloadInferences();
          }}
        />
      )}
      <ImagesModal inference={viewing} onClose={() => setViewing(null)} />
      <RenameInferenceModal
        key={renaming?.id ?? "none"}
        inference={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={() => {
          setRenaming(null);
          void reloadInferences();
        }}
      />
    </section>
  );
}
