"""FastAPI application entrypoint.

Wires together the routers, CORS, static file serving for generated images,
and database initialisation. Run with:

    uv run uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config, jobs
from .db import init_db
from .routers import checkpoints, evaluations, experiments, inferences, projects


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    init_db()
    yield
    jobs.shutdown()


app = FastAPI(title="ModelInference", version="0.1.0", lifespan=lifespan)

# Dev frontend runs on a separate Vite port; allow any origin for simplicity.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(experiments.router)
app.include_router(checkpoints.router)
app.include_router(inferences.router)
app.include_router(evaluations.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Serve generated inference images (and any data artifacts) statically.
# e.g. GET /files/inferences/<id>/image_000.png
app.mount("/files", StaticFiles(directory=str(config.DATA_DIR)), name="files")
