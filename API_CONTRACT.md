# ModelInference — API Contract (source of truth)

Backend: FastAPI + SQLModel + SQLite (`backend/`). Frontend: React + Vite + TS (`frontend/`).
All endpoints are prefixed `/api`. Generated images are served statically at `/files/...`.

The models, serializers, schemas, db session, jobs runner, config, and mock engine
already exist. Implementers must NOT change them except where this doc says so.

## Data shapes (responses, produced by `app/serializers.py`)

```
ProjectOut = {
  id:int, name:str, description:str,
  inference_command:str, inference_workdir:str,
  inference_param_schema: ParamDef[],     // [{name,label,type,default,options?}]
  vlm_base_url:str, vlm_model:str, vlm_api_key_set:bool, eval_prompt:str,
  created_at:str (ISO)
}
ParamDef = { name:str, label:str, type:"text"|"number"|"select", default?:any, options?:string[] }

ExperimentOut = { id, project_id, name, description, hyperparameters:object, created_at }

CheckpointOut = {
  id, experiment_id, display_name, source_host, source_path, local_path,
  status:"pending"|"copying"|"ready"|"failed", size_bytes:int, message:str,
  metadata:object,   // parsed config.yaml/config.yml at the checkpoint root, {} if none
  created_at
}

InferenceOut = {
  id, checkpoint_id, experiment_id, name, params:object,
  command:str, workdir:str,           // snapshotted from the chosen inference engine
  test_set_id:int|null,               // test set ("测试集") this run used, if any
  status:"pending"|"running"|"done"|"failed", output_dir:str, log:str, created_at
}

EvaluationOut = {
  id, project_id, inference_a_id, inference_b_id,
  status:"pending"|"running"|"done"|"failed",
  result: { winner?:"A"|"B"|"tie", score_a?:number, score_b?:number, reason?:string, raw?:string },
  error:str, created_at
}

TestSetOut = { id, name, path:str, description:str, created_at }   // global preset: a folder of input/reference (lq) images
```

Request bodies are the Pydantic models in `app/schemas.py` (already written):
`ProjectCreate/Update`, `ExperimentCreate/Update`, `CheckpointCreate/Update`,
`InferenceCreate/Update`, `EvaluationCreate`.

## Endpoints

### Projects — `app/routers/projects.py`, `router = APIRouter(prefix="/api", tags=["projects"])`
- `GET  /api/projects` → ProjectOut[] (newest first)
- `POST /api/projects` (ProjectCreate) → ProjectOut, 201.
  Defaults when field is None: `inference_command`→`config.DEFAULT_INFERENCE_COMMAND`,
  `inference_param_schema`→`config.DEFAULT_INFERENCE_PARAM_SCHEMA`,
  `eval_prompt`→`config.DEFAULT_EVAL_PROMPT`. Store list/dict fields as `json.dumps(...)`.
- `GET  /api/projects/{project_id}` → ProjectOut (404 if missing)
- `PUT  /api/projects/{project_id}` (ProjectUpdate) → ProjectOut.
  Use `body.model_dump(exclude_unset=True)` so only provided fields change.
  For `inference_param_schema` re-`json.dumps`. `vlm_api_key`: update only if present;
  empty string clears it.
- `DELETE /api/projects/{project_id}` → 204. Cascade-delete all experiments, their
  checkpoints, inferences, and the project's evaluations; remove on-disk files
  (checkpoint `local_path` dirs and inference `output_dir`s). Use a shared helper.

### Experiments — `app/routers/experiments.py`
- `GET  /api/projects/{project_id}/experiments` → ExperimentOut[] (404 if project missing)
- `POST /api/projects/{project_id}/experiments` (ExperimentCreate) → ExperimentOut, 201
- `GET  /api/experiments/{experiment_id}` → ExperimentOut
- `PUT  /api/experiments/{experiment_id}` (ExperimentUpdate) → ExperimentOut (exclude_unset; hyperparameters re-json.dumps)
- `DELETE /api/experiments/{experiment_id}` → 204. Cascade: checkpoints + inferences + files.

### Checkpoints — `app/routers/checkpoints.py` (+ `app/services/copy_service.py`)
- `GET  /api/experiments/{experiment_id}/checkpoints` → CheckpointOut[]
- `POST /api/experiments/{experiment_id}/checkpoints` (CheckpointCreate) → CheckpointOut, 201.
  Create row with status `copying`, set `local_path = config.CHECKPOINTS_DIR/<id>/`, then
  `jobs.submit(copy_service.copy_checkpoint, checkpoint_id)`. Return immediately.
- `GET  /api/checkpoints/{checkpoint_id}` → CheckpointOut
- `PUT  /api/checkpoints/{checkpoint_id}` (CheckpointUpdate) → CheckpointOut (rename display_name only; never touch files)
- `DELETE /api/checkpoints/{checkpoint_id}` → 204. Remove `local_path` dir, dependent inferences + their output dirs.
- `POST /api/checkpoints/{checkpoint_id}/recopy` → CheckpointOut. Reset status→`copying`, message="", resubmit copy job.

**copy_service.copy_checkpoint(checkpoint_id):** open `db.session_scope()`, load checkpoint, set
status `copying`. Build source: if `source_host` empty → local path `source_path`; else
`f"{source_host}:{source_path}"`. Destination = `local_path` (mkdir parents). Run
`rsync -az --info=progress2 <src> <dst>` via `subprocess.run` (or scp -r if rsync absent).
For ssh use `-e "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"`. On success:
compute total size (sum of file sizes under dst), set status `ready`, size_bytes, message="".
On failure (non-zero return or exception): status `failed`, message=stderr/exception. Commit.
NOTE: trailing-slash semantics — append "/" to a directory source so contents land inside dst.

### Inferences — `app/routers/inferences.py` (+ `app/services/inference_service.py`)
- `GET  /api/checkpoints/{checkpoint_id}/inferences` → InferenceOut[]
- `GET  /api/experiments/{experiment_id}/inferences` → InferenceOut[] (for the compare picker)
- `POST /api/checkpoints/{checkpoint_id}/inferences` (InferenceCreate) → InferenceOut, 201.
  Checkpoint must be `ready` (else 409). Create row status `running`,
  `output_dir = config.INFERENCES_DIR/<id>/`, `experiment_id` copied from checkpoint, then
  `jobs.submit(inference_service.run_inference, inference_id)`. Return immediately.
  `InferenceCreate` also accepts optional `engine_id` (snapshots the engine's command/workdir),
  `test_set_id` (404 if missing; recorded on the row for browse-time filtering), and
  `test_set_param_key` (when both are given, the test set's `path` is written into
  `params[test_set_param_key]` so it reaches the command line like any other param).
- `GET  /api/inferences/{inference_id}` → InferenceOut
- `PUT  /api/inferences/{inference_id}` (InferenceUpdate) → InferenceOut (rename)
- `DELETE /api/inferences/{inference_id}` → 204 (remove output_dir)
- `GET  /api/inferences/{inference_id}/images` → `{ "images": string[] }` where each is a
  URL path like `/files/inferences/<id>/image_000.png`, sorted by filename. Only files whose
  suffix is in `config.IMAGE_EXTENSIONS`. Empty list if dir missing.

**inference_service.run_inference(inference_id):** open session, load inference + its
checkpoint + the experiment's project. Set status `running`. Build command from
`project.inference_command` via safe substitution: tokens `{checkpoint}`→checkpoint.local_path,
`{output_dir}`→inference.output_dir, plus every key in inference.params (`json.loads`).
Use a `SafeFormatter`/`format_map` with a dict that leaves unknown tokens intact (don't crash
on missing keys). mkdir output_dir. Run via `subprocess.run(cmd, shell=True, cwd=workdir or None,
capture_output=True, text=True, timeout=1800)`. Append stdout+stderr to `inference.log`.
On returncode 0 → status `done`; else `failed`. Commit. Guard exceptions → status `failed`,
log the traceback.

### Evaluations — `app/routers/evaluations.py` (+ `app/services/vlm_service.py`)
- `POST /api/evaluations` (EvaluationCreate) → EvaluationOut, 201. Validate project exists,
  both inferences exist, belong to that project (via experiment→project), and are `done`
  (else 400/409). Create row status `running`, then `jobs.submit(vlm_service.run_evaluation, eval_id)`.
- `GET  /api/evaluations/{evaluation_id}` → EvaluationOut
- `GET  /api/projects/{project_id}/evaluations` → EvaluationOut[]
- `GET  /api/evaluations?a={id}&b={id}` → most recent EvaluationOut for that unordered pair, or 404.

**vlm_service.run_evaluation(eval_id):** open session, load evaluation + project + both
inferences. If project has no `vlm_base_url`/`vlm_model` → status `failed`,
error "VLM not configured". Gather up to N (cap ~6) images from each inference's output_dir,
base64-encode as data URIs. Build an OpenAI chat-completions request to
`f"{vlm_base_url.rstrip('/')}/chat/completions"` with `Authorization: Bearer <key>`, model,
`messages=[{role:"user", content:[ {type:"text", text: project.eval_prompt + framing},
{type:"text",text:"Group A:"}, ...imageA parts..., {type:"text",text:"Group B:"}, ...imageB... ]}]`,
`temperature:0`, `max_tokens:800`. POST with `httpx.Client(timeout=120)`. Parse
`choices[0].message.content`; strip ```` ```json ```` fences; `json.loads`. Store
`{winner,score_a,score_b,reason, raw:<full text>}` in result, status `done`. On any error →
status `failed`, error=str(e). Image content part shape:
`{"type":"image_url","image_url":{"url":"data:image/png;base64,...."}}`.

### Settings: test sets — `app/routers/settings.py` (`router` prefix `/api/settings`)
A test set ("测试集") is a global preset: a named folder of input/reference (lq) images, picked
when running an inference and used on the browse page to filter results and to show its images
as a read-only reference column beside the outputs.
- `GET  /api/settings/test-sets` → TestSetOut[] (newest first)
- `POST /api/settings/test-sets` (TestSetCreate) → TestSetOut, 201
- `GET  /api/settings/test-sets/{id}` → TestSetOut (404 if missing)
- `PUT  /api/settings/test-sets/{id}` (TestSetUpdate) → TestSetOut (`exclude_unset` partial update)
- `DELETE /api/settings/test-sets/{id}` → 204 (inferences keep their now-dangling `test_set_id`)
- `GET  /api/settings/test-sets/{id}/images` → `{ "images": string[] }`. Top-level image files in
  the folder (suffix in `config.IMAGE_EXTENSIONS`), each a URL to the `/file` endpoint; `[]` when
  the path is unset or not a directory. Unlike inference outputs, a test set lives at an arbitrary
  path (outside `DATA_DIR`), so it is NOT served by the static `/files` mount.
- `GET  /api/settings/test-sets/{id}/file?name=<filename>` → streams one image. Traversal-guarded:
  `name` must be a bare filename whose resolved path sits directly inside the resolved test set
  directory and has a recognised image suffix (else 400/404).

## Frontend (already-written foundation: `src/types.ts`, `src/api.ts`, `src/styles.css`, `src/main.tsx`)
Components import the typed `api` client and the `*Out` types. Use the API exactly as above.
Polling: while a checkpoint is `copying` or an inference is `running` or an evaluation is
`running`, re-fetch every ~2s until terminal.

## Conventions
- 404 via `raise HTTPException(404, "not found")` when a row is missing.
- Routers depend on `Session = Depends(get_session)` from `app.db`.
- Return serializer dicts directly (FastAPI serialises them). Set `status_code=201` on creates.
- Keep secrets out of responses (serializers already handle this).
