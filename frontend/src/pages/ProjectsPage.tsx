import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Project } from "../types";
import { useAsync } from "../hooks";
import {
  ConfirmButton,
  ErrorBanner,
  Modal,
  Spinner,
  formatDate,
} from "../components/ui";

const DELETE_MESSAGE =
  "Delete this project? This permanently removes all of its experiments, checkpoints, inferences, and evaluations.";

function NewProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const project = await api.createProject({
        name: name.trim(),
        description: description.trim(),
      });
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Project">
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <div className="field">
          <label htmlFor="project-name">Name</label>
          <input
            id="project-name"
            value={name}
            autoFocus
            required
            placeholder="My project"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="project-description">Description</label>
          <textarea
            id="project-description"
            value={description}
            placeholder="What is this project about?"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="btn-row spread">
          <button type="button" className="btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || !name.trim()}
          >
            {saving ? "Creating…" : "Create Project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="card clickable" onClick={onOpen}>
      <h3>{project.name}</h3>
      <p className="muted">{project.description || "No description"}</p>
      <div className="btn-row small">
        <span className="badge">
          <span className="dot" />
          {project.vlm_model || "VLM not set"}
        </span>
        <span className="badge">
          <span className="dot" />
          {formatDate(project.created_at)}
        </span>
      </div>
      <div className="btn-row" style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
        <ConfirmButton message={DELETE_MESSAGE} onConfirm={onDelete}>
          Delete
        </ConfirmButton>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.listProjects(), []);
  const [modalOpen, setModalOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDelete = async (id: number) => {
    setActionError(null);
    try {
      await api.deleteProject(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      await reload();
    }
  };

  return (
    <div className="container">
      <div className="toolbar spread">
        <h1>Projects</h1>
        <button className="btn-primary" onClick={() => setModalOpen(true)}>
          + New Project
        </button>
      </div>

      <ErrorBanner error={error ?? actionError} />

      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <div className="empty">No projects yet. Create one to get started.</div>
      ) : (
        <div className="grid">
          {data.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => navigate(`/projects/${project.id}`)}
              onDelete={() => handleDelete(project.id)}
            />
          ))}
        </div>
      )}

      <NewProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(project) => navigate(`/projects/${project.id}`)}
      />
    </div>
  );
}
