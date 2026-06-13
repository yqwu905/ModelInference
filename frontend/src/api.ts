// Typed API client. All calls go to same-origin /api (Vite proxies to backend).
import type {
  Checkpoint,
  CheckpointInput,
  Evaluation,
  Experiment,
  ExperimentInput,
  Inference,
  InferenceInput,
  InferenceEngine,
  InferenceEngineInput,
  Project,
  ProjectInput,
  ServerConfig,
  ServerInput,
  VlmPreset,
  VlmPresetInput,
  VlmTestResult,
} from "./types";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = (data && (data.detail ?? JSON.stringify(data))) || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // Projects
  listProjects: () => req<Project[]>("GET", "/api/projects"),
  getProject: (id: number) => req<Project>("GET", `/api/projects/${id}`),
  createProject: (body: ProjectInput) => req<Project>("POST", "/api/projects", body),
  updateProject: (id: number, body: ProjectInput) =>
    req<Project>("PUT", `/api/projects/${id}`, body),
  deleteProject: (id: number) => req<void>("DELETE", `/api/projects/${id}`),

  // Experiments
  listExperiments: (projectId: number) =>
    req<Experiment[]>("GET", `/api/projects/${projectId}/experiments`),
  getExperiment: (id: number) => req<Experiment>("GET", `/api/experiments/${id}`),
  createExperiment: (projectId: number, body: ExperimentInput) =>
    req<Experiment>("POST", `/api/projects/${projectId}/experiments`, body),
  updateExperiment: (id: number, body: ExperimentInput) =>
    req<Experiment>("PUT", `/api/experiments/${id}`, body),
  deleteExperiment: (id: number) => req<void>("DELETE", `/api/experiments/${id}`),

  // Checkpoints
  listCheckpoints: (experimentId: number) =>
    req<Checkpoint[]>("GET", `/api/experiments/${experimentId}/checkpoints`),
  getCheckpoint: (id: number) => req<Checkpoint>("GET", `/api/checkpoints/${id}`),
  createCheckpoint: (experimentId: number, body: CheckpointInput) =>
    req<Checkpoint>("POST", `/api/experiments/${experimentId}/checkpoints`, body),
  updateCheckpoint: (id: number, displayName: string) =>
    req<Checkpoint>("PUT", `/api/checkpoints/${id}`, { display_name: displayName }),
  deleteCheckpoint: (id: number) => req<void>("DELETE", `/api/checkpoints/${id}`),
  recopyCheckpoint: (id: number) =>
    req<Checkpoint>("POST", `/api/checkpoints/${id}/recopy`),

  // Inferences
  listInferencesByCheckpoint: (checkpointId: number) =>
    req<Inference[]>("GET", `/api/checkpoints/${checkpointId}/inferences`),
  listInferencesByExperiment: (experimentId: number) =>
    req<Inference[]>("GET", `/api/experiments/${experimentId}/inferences`),
  getInference: (id: number) => req<Inference>("GET", `/api/inferences/${id}`),
  createInference: (checkpointId: number, body: InferenceInput) =>
    req<Inference>("POST", `/api/checkpoints/${checkpointId}/inferences`, body),
  updateInference: (id: number, name: string) =>
    req<Inference>("PUT", `/api/inferences/${id}`, { name }),
  deleteInference: (id: number) => req<void>("DELETE", `/api/inferences/${id}`),
  getInferenceImages: (id: number) =>
    req<{ images: string[] }>("GET", `/api/inferences/${id}/images`),

  // Evaluations
  createEvaluation: (projectId: number, aId: number, bId: number) =>
    req<Evaluation>("POST", "/api/evaluations", {
      project_id: projectId,
      inference_a_id: aId,
      inference_b_id: bId,
    }),
  getEvaluation: (id: number) => req<Evaluation>("GET", `/api/evaluations/${id}`),
  listEvaluations: (projectId: number) =>
    req<Evaluation[]>("GET", `/api/projects/${projectId}/evaluations`),
  findEvaluation: (aId: number, bId: number) =>
    req<Evaluation>("GET", `/api/evaluations?a=${aId}&b=${bId}`),

  // Settings: servers
  listServers: () => req<ServerConfig[]>("GET", "/api/settings/servers"),
  createServer: (body: ServerInput) =>
    req<ServerConfig>("POST", "/api/settings/servers", body),
  updateServer: (id: number, body: ServerInput) =>
    req<ServerConfig>("PUT", `/api/settings/servers/${id}`, body),
  deleteServer: (id: number) => req<void>("DELETE", `/api/settings/servers/${id}`),

  // Settings: VLM presets
  listVlmPresets: () => req<VlmPreset[]>("GET", "/api/settings/vlm-presets"),
  createVlmPreset: (body: VlmPresetInput) =>
    req<VlmPreset>("POST", "/api/settings/vlm-presets", body),
  updateVlmPreset: (id: number, body: VlmPresetInput) =>
    req<VlmPreset>("PUT", `/api/settings/vlm-presets/${id}`, body),
  deleteVlmPreset: (id: number) =>
    req<void>("DELETE", `/api/settings/vlm-presets/${id}`),
  applyVlmPreset: (presetId: number, projectId: number) =>
    req<Project>("POST", `/api/settings/vlm-presets/${presetId}/apply/${projectId}`),
  testVlmPreset: (id: number) =>
    req<VlmTestResult>("POST", `/api/settings/vlm-presets/${id}/test`),

  // Settings: inference engines（推理工程）
  listInferenceEngines: () =>
    req<InferenceEngine[]>("GET", "/api/settings/inference-engines"),
  createInferenceEngine: (body: InferenceEngineInput) =>
    req<InferenceEngine>("POST", "/api/settings/inference-engines", body),
  updateInferenceEngine: (id: number, body: InferenceEngineInput) =>
    req<InferenceEngine>("PUT", `/api/settings/inference-engines/${id}`, body),
  deleteInferenceEngine: (id: number) =>
    req<void>("DELETE", `/api/settings/inference-engines/${id}`),
};
