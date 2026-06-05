# ModelInference

An AI training **checkpoint archival, inference, and comparison** tool.

It organises work into a four-level hierarchy and lets you copy checkpoints off
remote training servers, run a configurable inference engine against them, browse
and compare the resulting images (up to six runs side by side), and have a VLM
(any OpenAI-compatible API) judge which run is better.

```
Project ── Experiment ── Checkpoint ── Inference (images)
   │            │             │              │
   │            │             │              └─ run a configurable engine → images
   │            │             └─ rsync/scp from a server (display name ≠ filename)
   │            └─ training hyperparameters
   └─ inference-engine command + VLM evaluation prompt/credentials
```

## Features

- **Projects** — create/configure/delete. Each project owns its inference-engine
  command template and its VLM evaluation prompt + endpoint.
- **Experiments** — create/edit/delete; hold training hyperparameters.
- **Checkpoints** — copy from `host:path` (rsync over ssh) or a local path; the
  copy runs in the background with live status. Rename freely (display name only;
  on-disk files are untouched). If the checkpoint is a directory containing a
  `config.yaml` (or `config.yml`) at its root, it is parsed and attached as the
  checkpoint's metadata, viewable in the UI.
- **Inference** — run the project's engine against a checkpoint with a set of
  inference hyperparameters; results are images. Browse, rename, delete.
- **Compare** — view up to six inference image-sets in a side-by-side grid.
- **AI evaluation** — pick two runs and have a VLM return a structured JSON verdict
  (winner + scores + reason), shown inline with the winning run highlighted.

A **mock inference engine** (`backend/scripts/mock_inference.py`) ships by default so
the whole pipeline works end-to-end with no GPU — new projects are prefilled to use it.

## Architecture

- **Backend** — FastAPI + SQLModel + SQLite, managed with [uv]. Metadata in SQLite;
  checkpoints and generated images on disk under a single data dir
  (`MI_DATA_DIR`, default `backend/data/`). Images are served statically at `/files/...`.
- **Frontend** — React + Vite + TypeScript. Talks to `/api/*` (proxied to the backend in dev).

## Quick start

### 1. Backend (port 8000)

```bash
cd backend
uv sync                       # provisions Python + deps
uv run uvicorn app.main:app --reload --port 8000
```

### 2. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev                   # open http://localhost:5173
```

The Vite dev server proxies `/api` and `/files` to `http://localhost:8000`.

### Try it

1. Create a **Project** (defaults already point at the mock engine).
2. Add an **Experiment**, then **Copy checkpoint** — leave the SSH host blank and
   point `source path` at any local directory to copy it in.
3. Once the checkpoint is **ready**, **Run inference** (prompt / count / seed).
4. Open **Compare inferences**, select runs, and (with a VLM configured in the
   project's Settings) run an **AI comparison**.

### Configuring a real inference engine

In a project's **Settings**, set the **inference command** template. The tokens
`{checkpoint}` (the copied checkpoint's local path) and `{output_dir}` (where images
must be written) are always substituted; any other `{token}` is filled from the
inference parameters defined by the **parameter schema**. Example:

```
python infer.py --ckpt "{checkpoint}" --out "{output_dir}" --steps {steps} --prompt "{prompt}"
```

### Configuring VLM evaluation

In **Settings → VLM evaluation**, set the base URL (e.g. `https://api.openai.com/v1`),
model (e.g. `gpt-4o-mini`), API key, and the evaluation prompt. The prompt should ask
for JSON `{"winner","score_a","score_b","reason"}`; a sensible default is prefilled.

## Tests

```bash
cd backend && uv run pytest -q
```

[uv]: https://github.com/astral-sh/uv
