// Shared types mirroring the backend API contract (see API_CONTRACT.md).

export type ParamType = "text" | "number" | "select";

export interface ParamDef {
  name: string;
  label: string;
  type: ParamType;
  default?: unknown;
  options?: string[];
}

export interface Project {
  id: number;
  name: string;
  description: string;
  inference_command: string;
  inference_workdir: string;
  inference_param_schema: ParamDef[];
  default_engine_id: number | null;
  vlm_base_url: string;
  vlm_model: string;
  vlm_api_key_set: boolean;
  eval_prompt: string;
  created_at: string;
}

export interface Experiment {
  id: number;
  project_id: number;
  name: string;
  description: string;
  hyperparameters: Record<string, unknown>;
  created_at: string;
}

export type CheckpointStatus = "pending" | "copying" | "ready" | "failed";

export interface Checkpoint {
  id: number;
  experiment_id: number;
  display_name: string;
  source_host: string;
  source_path: string;
  local_path: string;
  status: CheckpointStatus;
  size_bytes: number;
  // Copy progress percent (0–100); 0 means indeterminate (remote source).
  progress: number;
  message: string;
  // Parsed config.yaml of a directory checkpoint (empty object when none).
  metadata: Record<string, unknown>;
  created_at: string;
}

export type InferenceStatus = "pending" | "running" | "done" | "failed";

export interface Inference {
  id: number;
  checkpoint_id: number;
  experiment_id: number;
  name: string;
  params: Record<string, unknown>;
  // Command/workdir snapshotted from the engine at creation (empty for legacy rows).
  command: string;
  workdir: string;
  status: InferenceStatus;
  output_dir: string;
  log: string;
  created_at: string;
}

export type EvaluationStatus = "pending" | "running" | "done" | "failed";

export interface EvaluationResult {
  winner?: "A" | "B" | "tie";
  score_a?: number;
  score_b?: number;
  reason?: string;
  raw?: string;
}

export interface Evaluation {
  id: number;
  project_id: number;
  inference_a_id: number;
  inference_b_id: number;
  status: EvaluationStatus;
  result: EvaluationResult;
  error: string;
  created_at: string;
}

// ---- request payloads ----
export interface ProjectInput {
  name?: string;
  description?: string;
  inference_command?: string;
  inference_workdir?: string;
  inference_param_schema?: ParamDef[];
  // null clears the project's default engine.
  default_engine_id?: number | null;
  vlm_base_url?: string;
  vlm_api_key?: string;
  vlm_model?: string;
  eval_prompt?: string;
}

export interface ExperimentInput {
  name?: string;
  description?: string;
  hyperparameters?: Record<string, unknown>;
}

export interface CheckpointInput {
  display_name: string;
  source_host?: string;
  source_path: string;
}

export interface InferenceInput {
  name: string;
  params: Record<string, unknown>;
  // Global engine to run with; its command/workdir are snapshotted server-side.
  engine_id?: number;
}

// ---- global settings ----
export interface ServerConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  default_path: string;
  description: string;
  // Whether an ssh password is saved (the raw password is never returned).
  password_set: boolean;
  created_at: string;
}

export interface ServerInput {
  name: string;
  host?: string;
  port?: number;
  default_path?: string;
  description?: string;
  // Provided non-empty => set; omitted => keep existing password on update.
  password?: string;
}

export interface VlmPreset {
  id: number;
  name: string;
  base_url: string;
  model: string;
  api_key_set: boolean;
  created_at: string;
}

export interface VlmPresetInput {
  name: string;
  base_url?: string;
  model?: string;
  // Provided non-empty => set; omitted => keep existing key on update.
  api_key?: string;
}

// Result of probing a VLM endpoint (POST /vlm-presets/{id}/test). The extra
// fields are present only when ok is true.
export interface VlmTestResult {
  ok: boolean;
  message: string;
  latency_ms?: number;
  model?: string;
  reply?: string;
}

export interface InferenceEngine {
  id: number;
  name: string;
  command: string;
  workdir: string;
  // Parameter defaults as plain key/value pairs (not a typed schema).
  params: Record<string, unknown>;
  created_at: string;
}

export interface InferenceEngineInput {
  name: string;
  command?: string;
  workdir?: string;
  params?: Record<string, unknown>;
}
