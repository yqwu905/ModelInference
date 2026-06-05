import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { Evaluation, Inference } from "../types";
import { useAsync, usePolling } from "../hooks";
import {
  ErrorBanner,
  Lightbox,
  Spinner,
  StatusBadge,
  formatDate,
} from "../components/ui";

const MAX_SELECTED = 6;

/** Render the params object of an inference compactly. */
function paramsSummary(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return "no params";
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(", ");
}

function ImageThumbs({
  inferenceId,
  images,
  loading,
  onOpen,
}: {
  inferenceId: number;
  images: string[] | undefined;
  loading: boolean;
  onOpen: (src: string) => void;
}) {
  if (loading) return <Spinner />;
  if (!images || images.length === 0) {
    return <div className="muted small">No images.</div>;
  }
  return (
    <div className="thumbs">
      {images.map((src) => (
        <img
          key={`${inferenceId}-${src}`}
          src={src}
          alt=""
          loading="lazy"
          onClick={() => onOpen(src)}
        />
      ))}
    </div>
  );
}

export default function ComparePage() {
  const params = useParams();
  const experimentId = Number(params.experimentId);

  // --- core data loading ---
  const {
    data: experiment,
    loading: loadingExperiment,
    error: experimentError,
  } = useAsync(() => api.getExperiment(experimentId), [experimentId]);

  const { data: project, error: projectError } = useAsync(
    () =>
      experiment
        ? api.getProject(experiment.project_id)
        : Promise.resolve(null),
    [experiment?.project_id],
  );

  const {
    data: inferences,
    loading: loadingInferences,
    error: inferencesError,
  } = useAsync(
    () => api.listInferencesByExperiment(experimentId),
    [experimentId],
  );

  // --- selection state ---
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // --- lazily-loaded images cache, keyed by inference id ---
  const [imagesById, setImagesById] = useState<Record<number, string[]>>({});
  const [imagesLoading, setImagesLoading] = useState<Record<number, boolean>>(
    {},
  );

  // --- lightbox ---
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // --- AI evaluation state ---
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [startingEval, setStartingEval] = useState(false);

  // --- past evaluations ---
  const {
    data: pastEvaluations,
    reload: reloadPast,
  } = useAsync(
    () =>
      project ? api.listEvaluations(project.id) : Promise.resolve([]),
    [project?.id],
  );

  const doneInferences = useMemo(
    () => (inferences ?? []).filter((inf) => inf.status === "done"),
    [inferences],
  );

  const inferenceById = useMemo(() => {
    const map = new Map<number, Inference>();
    for (const inf of doneInferences) map.set(inf.id, inf);
    return map;
  }, [doneInferences]);

  // Keep only ids that still exist & are done; preserve selection order.
  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => inferenceById.get(id))
        .filter((inf): inf is Inference => inf !== undefined),
    [selectedIds, inferenceById],
  );

  // Fetch images for any selected inference not yet cached.
  useEffect(() => {
    for (const inf of selected) {
      if (imagesById[inf.id] !== undefined || imagesLoading[inf.id]) continue;
      setImagesLoading((prev) => ({ ...prev, [inf.id]: true }));
      api
        .getInferenceImages(inf.id)
        .then((res) =>
          setImagesById((prev) => ({ ...prev, [inf.id]: res.images })),
        )
        .catch(() =>
          setImagesById((prev) => ({ ...prev, [inf.id]: [] })),
        )
        .finally(() =>
          setImagesLoading((prev) => ({ ...prev, [inf.id]: false })),
        );
    }
  }, [selected, imagesById, imagesLoading]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTED) return prev;
      return [...prev, id];
    });
    // A change in selection invalidates any in-flight verdict.
    setEvaluation(null);
    setEvalError(null);
  };

  // Exactly-two selection drives the AI comparison.
  const pairA = selected.length === 2 ? selected[0] : null;
  const pairB = selected.length === 2 ? selected[1] : null;

  // Preload an existing verdict for the chosen pair (best effort).
  useEffect(() => {
    let cancelled = false;
    setEvaluation(null);
    setEvalError(null);
    if (!pairA || !pairB) return;
    api
      .findEvaluation(pairA.id, pairB.id)
      .then((ev) => {
        // Adopt a terminal verdict (to display) or an in-flight one (so the
        // poller resumes it) instead of silently starting a duplicate.
        if (
          !cancelled &&
          ev &&
          (ev.status === "done" ||
            ev.status === "running" ||
            ev.status === "pending")
        ) {
          setEvaluation(ev);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [pairA?.id, pairB?.id]);

  // Poll a running evaluation until terminal.
  const evalRunning =
    evaluation !== null &&
    (evaluation.status === "running" || evaluation.status === "pending");

  usePolling(
    () => {
      if (!evaluation) return;
      api
        .getEvaluation(evaluation.id)
        .then((ev) => {
          setEvaluation(ev);
          if (ev.status === "done" || ev.status === "failed") {
            void reloadPast();
          }
        })
        .catch((e) =>
          setEvalError(e instanceof Error ? e.message : String(e)),
        );
    },
    evalRunning,
    2000,
  );

  const runComparison = async () => {
    if (!project || !pairA || !pairB) return;
    setStartingEval(true);
    setEvalError(null);
    try {
      const ev = await api.createEvaluation(project.id, pairA.id, pairB.id);
      setEvaluation(ev);
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : String(e));
    } finally {
      setStartingEval(false);
    }
  };

  // Map an evaluation winner ("A"/"B") to an inference id using the
  // evaluation's OWN inference_a_id/inference_b_id — not the current selection
  // order, which may be reversed when a prior verdict is preloaded.
  const winnerInferenceId = useMemo(() => {
    if (!evaluation || evaluation.status !== "done") return null;
    const w = evaluation.result?.winner;
    if (w === "A") return evaluation.inference_a_id;
    if (w === "B") return evaluation.inference_b_id;
    return null;
  }, [evaluation]);

  const winnerInf = useMemo(
    () =>
      winnerInferenceId != null
        ? inferenceById.get(winnerInferenceId) ?? null
        : null,
    [winnerInferenceId, inferenceById],
  );

  const winnerScore = useMemo(() => {
    if (!evaluation || evaluation.status !== "done") return null;
    const w = evaluation.result?.winner;
    if (w === "A") return evaluation.result?.score_a ?? null;
    if (w === "B") return evaluation.result?.score_b ?? null;
    return null;
  }, [evaluation]);

  // --- render ---
  const topError = experimentError || projectError;

  if (loadingExperiment) {
    return (
      <div className="container">
        <Spinner />
      </div>
    );
  }

  if (topError || !experiment) {
    return (
      <div className="container">
        <ErrorBanner error={topError || "Experiment not found."} />
      </div>
    );
  }

  return (
    <div className="container">
      <div className="breadcrumbs">
        {project ? (
          <>
            <Link to={`/projects/${project.id}`}>{project.name}</Link>
            {" / "}
          </>
        ) : null}
        <Link to={`/experiments/${experimentId}`}>{experiment.name}</Link>
        {" / Compare"}
      </div>

      <div className="toolbar spread">
        <h1>Compare Inferences</h1>
      </div>

      <ErrorBanner error={inferencesError} />

      {loadingInferences ? (
        <Spinner />
      ) : doneInferences.length === 0 ? (
        <div className="empty">
          No completed inferences yet. Run some inferences first.
        </div>
      ) : (
        <>
          {/* selector */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="spread" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>
                Select inferences ({selected.length}/{MAX_SELECTED})
              </h3>
              {selected.length >= MAX_SELECTED && (
                <span className="muted small">Maximum 6</span>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {doneInferences.map((inf) => {
                const isSelected = selectedIds.includes(inf.id);
                const atMax =
                  !isSelected && selected.length >= MAX_SELECTED;
                return (
                  <button
                    key={inf.id}
                    type="button"
                    className={isSelected ? "btn-sm btn-primary" : "btn-sm"}
                    disabled={atMax}
                    title={paramsSummary(inf.params)}
                    onClick={() => toggleSelect(inf.id)}
                  >
                    {isSelected ? "✓ " : ""}
                    {inf.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI comparison panel */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="spread" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>AI Comparison</h3>
              {selected.length === 2 && (
                <button
                  className="btn-primary"
                  disabled={startingEval || evalRunning}
                  onClick={() => void runComparison()}
                >
                  {startingEval || evalRunning ? "Running…" : "Compare with AI"}
                </button>
              )}
            </div>

            {selected.length !== 2 ? (
              <div className="muted small">
                Select exactly 2 inferences to run an AI comparison.
              </div>
            ) : (
              <>
                {pairA && pairB && (
                  <div className="muted small" style={{ marginBottom: 10 }}>
                    A: <span className="mono">{pairA.name}</span> &nbsp;vs&nbsp;
                    B: <span className="mono">{pairB.name}</span>
                  </div>
                )}

                <ErrorBanner error={evalError} />

                {evalRunning && (
                  <div className="btn-row small" style={{ alignItems: "center" }}>
                    <Spinner /> Evaluating with VLM…
                  </div>
                )}

                {evaluation && evaluation.status === "failed" && (
                  <>
                    <ErrorBanner
                      error={evaluation.error || "Evaluation failed."}
                    />
                    {evaluation.error
                      ?.toLowerCase()
                      .includes("vlm not configured") &&
                      project && (
                        <div className="small">
                          <Link to={`/projects/${project.id}`}>
                            configure VLM
                          </Link>{" "}
                          for this project, then try again.
                        </div>
                      )}
                  </>
                )}

                {evaluation && evaluation.status === "done" && (
                  <div className="card" style={{ background: "var(--bg-3)" }}>
                    <div className="spread">
                      <h4 style={{ margin: 0 }}>
                        Winner:{" "}
                        {evaluation.result?.winner === "tie"
                          ? "Tie"
                          : winnerInferenceId != null
                            ? `${evaluation.result?.winner} — ${
                                winnerInf?.name ?? `#${winnerInferenceId}`
                              }`
                            : "—"}
                      </h4>
                      <span className="badge done">
                        <span className="dot" />
                        score:{" "}
                        {evaluation.result?.score_a ?? "—"} vs{" "}
                        {evaluation.result?.score_b ?? "—"}
                      </span>
                    </div>
                    {evaluation.result?.reason && (
                      <p className="small" style={{ marginBottom: 0 }}>
                        {evaluation.result.reason}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* compare grid */}
          {selected.length === 0 ? (
            <div className="empty">
              Select inferences above to compare them side by side.
            </div>
          ) : (
            <div
              className="compare-grid"
              style={{
                gridTemplateColumns: `repeat(${Math.min(
                  selected.length,
                  6,
                )}, minmax(0,1fr))`,
              }}
            >
              {selected.map((inf) => {
                const isWinner = winnerInferenceId === inf.id;
                return (
                  <div
                    key={inf.id}
                    className={`compare-col${isWinner ? " winner" : ""}`}
                  >
                    <h4>
                      <span className="mono">{inf.name}</span>
                      {isWinner ? (
                        <span className="badge done">
                          <span className="dot" />
                          🏆 winner{winnerScore != null ? ` ${winnerScore}` : ""}
                        </span>
                      ) : (
                        <StatusBadge status={inf.status} />
                      )}
                    </h4>
                    <div className="muted small" style={{ marginBottom: 8 }}>
                      {paramsSummary(inf.params)}
                    </div>
                    <ImageThumbs
                      inferenceId={inf.id}
                      images={imagesById[inf.id]}
                      loading={!!imagesLoading[inf.id]}
                      onOpen={setLightboxSrc}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* past evaluations */}
          {pastEvaluations && pastEvaluations.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>Past evaluations</h3>
              <div className="col" style={{ gap: 8 }}>
                {pastEvaluations.map((ev) => {
                  const a = inferenceById.get(ev.inference_a_id);
                  const b = inferenceById.get(ev.inference_b_id);
                  return (
                    <div key={ev.id} className="kv">
                      <span className="k">When</span>
                      <span>{formatDate(ev.created_at)}</span>
                      <span className="k">Pair</span>
                      <span className="mono">
                        {a?.name ?? `#${ev.inference_a_id}`} vs{" "}
                        {b?.name ?? `#${ev.inference_b_id}`}
                      </span>
                      <span className="k">Status</span>
                      <span>
                        <StatusBadge status={ev.status} />
                      </span>
                      {ev.status === "done" && (
                        <>
                          <span className="k">Winner</span>
                          <span>
                            {ev.result?.winner ?? "—"}
                            {ev.result?.score_a != null ||
                            ev.result?.score_b != null
                              ? ` (${ev.result?.score_a ?? "—"} vs ${
                                  ev.result?.score_b ?? "—"
                                })`
                              : ""}
                          </span>
                          {ev.result?.reason && (
                            <>
                              <span className="k">Reason</span>
                              <span className="small muted">
                                {ev.result.reason}
                              </span>
                            </>
                          )}
                        </>
                      )}
                      {ev.status === "failed" && ev.error && (
                        <>
                          <span className="k">Error</span>
                          <span className="small muted">{ev.error}</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
