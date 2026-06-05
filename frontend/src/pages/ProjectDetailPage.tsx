import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { Experiment, ExperimentInput, ParamDef, Project, ProjectInput } from "../types";
import {
  ConfirmButton,
  ErrorBanner,
  formatDate,
  Modal,
  Spinner,
} from "../components/ui";

type Tab = "experiments" | "settings";

export default function ProjectDetailPage() {
  const { projectId: projectIdParam } = useParams();
  const projectId = Number(projectIdParam);
  const navigate = useNavigate();

  const project = useAsync<Project>(() => api.getProject(projectId), [projectId]);
  const experiments = useAsync<Experiment[]>(() => api.listExperiments(projectId), [projectId]);

  const [tab, setTab] = useState<Tab>("experiments");

  if (project.loading && !project.data) {
    return (
      <div className="container">
        <Spinner />
      </div>
    );
  }
  if (project.error || !project.data) {
    return (
      <div className="container">
        <ErrorBanner error={project.error ?? "Project not found"} />
        <Link to="/">Back to projects</Link>
      </div>
    );
  }

  const proj = project.data;

  return (
    <div className="container">
      <div className="breadcrumbs">
        <Link to="/">Projects</Link> / {proj.name}
      </div>

      <h1>{proj.name}</h1>

      <div className="tabs">
        <div
          className={`tab${tab === "experiments" ? " active" : ""}`}
          onClick={() => setTab("experiments")}
        >
          Experiments
        </div>
        <div
          className={`tab${tab === "settings" ? " active" : ""}`}
          onClick={() => setTab("settings")}
        >
          Settings
        </div>
      </div>

      {tab === "experiments" ? (
        <ExperimentsTab
          projectId={projectId}
          experiments={experiments.data ?? []}
          loading={experiments.loading}
          error={experiments.error}
          reload={experiments.reload}
          onOpen={(id) => navigate(`/experiments/${id}`)}
        />
      ) : (
        <SettingsTab project={proj} onSaved={project.reload} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Experiments tab
// ---------------------------------------------------------------------------

function ExperimentsTab(props: {
  projectId: number;
  experiments: Experiment[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void> | void;
  onOpen: (id: number) => void;
}) {
  const { projectId, experiments, loading, error, reload, onOpen } = props;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Experiment | null>(null);

  return (
    <div>
      <div className="toolbar">
        <button className="btn-primary" onClick={() => setCreating(true)}>
          + New Experiment
        </button>
      </div>

      <ErrorBanner error={error} />

      {loading && experiments.length === 0 ? (
        <Spinner />
      ) : experiments.length === 0 ? (
        <div className="empty">
          <h3>No experiments yet</h3>
          <p className="muted">Create an experiment to organise checkpoints and inferences.</p>
        </div>
      ) : (
        <div className="grid">
          {experiments.map((e) => {
            const paramCount = Object.keys(e.hyperparameters ?? {}).length;
            return (
              <div key={e.id} className="card clickable" onClick={() => onOpen(e.id)}>
                <h3>{e.name}</h3>
                {e.description && <p className="muted">{e.description}</p>}
                <p className="small muted">
                  {paramCount} hyperparameter{paramCount === 1 ? "" : "s"} ·{" "}
                  {formatDate(e.created_at)}
                </p>
                <div className="btn-row">
                  <button
                    className="btn-sm"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEditing(e);
                    }}
                  >
                    Edit
                  </button>
                  <span onClick={(ev) => ev.stopPropagation()}>
                    <ConfirmButton
                      message={`Delete experiment "${e.name}"? This removes its checkpoints and inferences.`}
                      onConfirm={async () => {
                        await api.deleteExperiment(e.id);
                        await reload();
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <ExperimentModal
          title="New Experiment"
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            await api.createExperiment(projectId, input);
            await reload();
            setCreating(false);
          }}
        />
      )}

      {editing && (
        <ExperimentModal
          title="Edit Experiment"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            await api.updateExperiment(editing.id, input);
            await reload();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ExperimentModal(props: {
  title: string;
  initial?: Experiment;
  onClose: () => void;
  onSubmit: (input: ExperimentInput) => Promise<void>;
}) {
  const { title, initial, onClose, onSubmit } = props;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [hyperText, setHyperText] = useState(
    initial ? JSON.stringify(initial.hyperparameters ?? {}, null, 2) : "{}"
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    let hyperparameters: Record<string, unknown>;
    try {
      const parsed = JSON.parse(hyperText || "{}");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Hyperparameters must be a JSON object.");
        return;
      }
      hyperparameters = parsed as Record<string, unknown>;
    } catch (e) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), description, hyperparameters });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={title}>
      <ErrorBanner error={error} />
      <div className="field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Experiment name" />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
        />
      </div>
      <div className="field">
        <label>Hyperparameters (JSON)</label>
        <textarea
          className="mono"
          value={hyperText}
          onChange={(e) => setHyperText(e.target.value)}
          rows={8}
        />
      </div>
      <div className="btn-row spread">
        <button onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? <Spinner /> : "Save"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

function SettingsTab(props: { project: Project; onSaved: () => Promise<void> | void }) {
  const { project, onSaved } = props;

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [inferenceCommand, setInferenceCommand] = useState(project.inference_command);
  const [inferenceWorkdir, setInferenceWorkdir] = useState(project.inference_workdir);
  const [schemaText, setSchemaText] = useState(
    JSON.stringify(project.inference_param_schema ?? [], null, 2)
  );
  const [vlmBaseUrl, setVlmBaseUrl] = useState(project.vlm_base_url);
  const [vlmModel, setVlmModel] = useState(project.vlm_model);
  const [vlmApiKey, setVlmApiKey] = useState("");
  const [evalPrompt, setEvalPrompt] = useState(project.eval_prompt);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync form state when the project (re)loads.
  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setInferenceCommand(project.inference_command);
    setInferenceWorkdir(project.inference_workdir);
    setSchemaText(JSON.stringify(project.inference_param_schema ?? [], null, 2));
    setVlmBaseUrl(project.vlm_base_url);
    setVlmModel(project.vlm_model);
    setVlmApiKey("");
    setEvalPrompt(project.eval_prompt);
  }, [project]);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(id);
  }, [saved]);

  const handleSave = async () => {
    let schema: ParamDef[];
    try {
      const parsed = JSON.parse(schemaText || "[]");
      if (!Array.isArray(parsed)) {
        setError("Inference parameter schema must be a JSON array.");
        return;
      }
      schema = parsed as ParamDef[];
    } catch (e) {
      setError(`Invalid parameter schema JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const payload: ProjectInput = {
      name,
      description,
      inference_command: inferenceCommand,
      inference_workdir: inferenceWorkdir,
      inference_param_schema: schema,
      vlm_base_url: vlmBaseUrl,
      vlm_model: vlmModel,
      eval_prompt: evalPrompt,
    };
    if (vlmApiKey.trim()) {
      payload.vlm_api_key = vlmApiKey;
    }

    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await api.updateProject(project.id, payload);
      await onSaved();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="col">
      <ErrorBanner error={error} />

      <div className="card">
        <h3>General</h3>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <h3>Inference engine</h3>
        <div className="field">
          <label>Inference command</label>
          <textarea
            className="mono"
            value={inferenceCommand}
            onChange={(e) => setInferenceCommand(e.target.value)}
            rows={3}
          />
          <p className="small muted">
            Tokens {"{checkpoint}"} and {"{output_dir}"} are auto-filled; other {"{tokens}"} come
            from inference parameters.
          </p>
        </div>
        <div className="field">
          <label>Inference workdir</label>
          <input
            value={inferenceWorkdir}
            onChange={(e) => setInferenceWorkdir(e.target.value)}
            placeholder="Working directory for the command (optional)"
          />
        </div>
        <div className="field">
          <label>Inference parameter schema (JSON)</label>
          <textarea
            className="mono"
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            rows={8}
          />
          <p className="small muted">
            Array of {"{ name, label, type, default?, options? }"} parameter definitions.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>VLM evaluation</h3>
        <div className="field-row">
          <div className="field">
            <label>VLM base URL</label>
            <input
              value={vlmBaseUrl}
              onChange={(e) => setVlmBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div className="field">
            <label>VLM model</label>
            <input
              value={vlmModel}
              onChange={(e) => setVlmModel(e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </div>
        </div>
        <div className="field">
          <label>VLM API key</label>
          <input
            type="password"
            value={vlmApiKey}
            onChange={(e) => setVlmApiKey(e.target.value)}
            placeholder={project.vlm_api_key_set ? "configured — leave blank to keep" : "sk-..."}
          />
        </div>
        <div className="field">
          <label>Evaluation prompt</label>
          <textarea
            value={evalPrompt}
            onChange={(e) => setEvalPrompt(e.target.value)}
            rows={5}
          />
        </div>
      </div>

      <div className="toolbar">
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <Spinner /> : "Save settings"}
        </button>
        {saved && <span className="small" style={{ color: "var(--accent-2)" }}>Saved</span>}
      </div>
    </div>
  );
}
