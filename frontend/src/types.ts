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
}
