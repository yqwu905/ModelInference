import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../api";
import type { Project } from "../types";
import { useAsync } from "../hooks";
import { ErrorBanner, Spinner } from "../components/ui";
import CheckpointPanel from "../components/CheckpointPanel";
import InferencePanel from "../components/InferencePanel";

export default function ExperimentDetailPage() {
  const { experimentId: experimentIdParam } = useParams();
  const experimentId = Number(experimentIdParam);
  const navigate = useNavigate();

  const {
    data: experiment,
    loading: experimentLoading,
    error: experimentError,
  } = useAsync(() => api.getExperiment(experimentId), [experimentId]);

  const {
    data: project,
    loading: projectLoading,
    error: projectError,
  } = useAsync<Project>(
    () =>
      experiment
        ? api.getProject(experiment.project_id)
        : Promise.reject(new Error("experiment not loaded")),
    [experiment?.project_id],
  );

  if (experimentLoading || (experiment && projectLoading)) {
    return (
      <div className="container">
        <Spinner />
      </div>
    );
  }

  if (experimentError || !experiment) {
    return (
      <div className="container">
        <ErrorBanner error={experimentError ?? "Experiment not found"} />
      </div>
    );
  }

  const hyperparams = Object.entries(experiment.hyperparameters);

  return (
    <div className="container">
      <div className="breadcrumbs">
        <Link to="/">Projects</Link>
        {" / "}
        {project ? (
          <Link to={`/projects/${project.id}`}>{project.name}</Link>
        ) : (
          <Link to={`/projects/${experiment.project_id}`}>Project</Link>
        )}
        {" / "}
        {experiment.name}
      </div>

      <div className="toolbar spread">
        <h1>{experiment.name}</h1>
        <button
          className="btn"
          onClick={() => navigate(`/experiments/${experimentId}/compare`)}
        >
          Compare inferences →
        </button>
      </div>

      {experiment.description && (
        <p className="muted" style={{ marginTop: -8 }}>
          {experiment.description}
        </p>
      )}

      <ErrorBanner error={projectError} />

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Hyperparameters</h3>
        {hyperparams.length === 0 ? (
          <p className="muted small">No hyperparameters recorded.</p>
        ) : (
          <div className="kv">
            {hyperparams.map(([k, v]) => (
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

      <CheckpointPanel experimentId={experimentId} />

      {project && <InferencePanel experimentId={experimentId} project={project} />}
    </div>
  );
}
