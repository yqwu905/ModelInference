import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Body1,
  Body1Strong,
  Button,
  Card,
  Caption1,
  Checkbox,
  Subtitle2,
  Title3,
  Tree,
  TreeItem,
  TreeItemLayout,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import type { TreeItemValue, TreeProps } from "@fluentui/react-components";
import { api } from "../api";
import type {
  Checkpoint,
  Evaluation,
  Experiment,
  Inference,
  Project,
} from "../types";
import { useAsync, usePolling } from "../hooks";
import { useSharedStyles } from "../theme/sharedStyles";
import { ErrorBanner, Lightbox, Spinner, StatusBadge } from "../components/ui";

const MAX_SELECTED = 6;

/** Resolved display context for a selected inference (results span projects). */
interface InfCtx {
  inf: Inference;
  projectId: number | null;
  projectName: string;
  expName: string;
  ckName: string;
}

const useStyles = makeStyles({
  layout: {
    display: "flex",
    alignItems: "flex-start",
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalL,
    flexWrap: "wrap",
  },
  treePane: {
    flexBasis: "340px",
    flexGrow: 0,
    flexShrink: 0,
    maxWidth: "100%",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalS,
    maxHeight: "calc(100vh - 180px)",
    overflowY: "auto",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  browsePane: {
    flexGrow: 1,
    flexBasis: "420px",
    minWidth: 0,
  },
  card: { marginBottom: tokens.spacingVerticalL },
  leafCheckbox: { display: "inline-flex" },
  placeholder: {
    paddingTop: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalXS,
  },
  pair: { marginBottom: tokens.spacingVerticalM },
  runningRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
  },
  resultCard: {
    backgroundColor: tokens.colorNeutralBackground3,
    marginTop: tokens.spacingVerticalM,
  },
  resultHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  grid: { display: "grid", gap: tokens.spacingHorizontalL },
  col: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
    minWidth: 0,
  },
  winnerCol: { border: `2px solid ${tokens.colorPaletteGreenBorder2}` },
  colHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
});

function paramsSummary(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return "无参数";
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(", ");
}

function ImageThumbs({
  inferenceId,
  images,
  loading,
  failed,
  onOpen,
  onRetry,
}: {
  inferenceId: number;
  images: string[] | undefined;
  loading: boolean;
  failed: boolean;
  onOpen: (src: string) => void;
  onRetry: () => void;
}) {
  const shared = useSharedStyles();
  if (loading) return <Spinner size="tiny" />;
  if (failed) {
    return (
      <Body1 className={mergeClasses(shared.muted, shared.small)}>
        图片加载失败。
        <Button size="small" appearance="transparent" onClick={onRetry}>
          重试
        </Button>
      </Body1>
    );
  }
  if (!images || images.length === 0) {
    return <Body1 className={mergeClasses(shared.muted, shared.small)}>暂无图片。</Body1>;
  }
  return (
    <div className={shared.thumbs}>
      {images.map((src) => (
        <img
          key={`${inferenceId}-${src}`}
          className={shared.thumbImg}
          src={src}
          alt=""
          loading="lazy"
          onClick={() => onOpen(src)}
        />
      ))}
    </div>
  );
}

export default function InferenceBrowsePage() {
  const shared = useSharedStyles();
  const s = useStyles();

  // --- tree data (lazy, controlled-open, cached so nothing refetches) ---
  const {
    data: projectsData,
    loading: projectsLoading,
    error: projectsError,
  } = useAsync(() => api.listProjects(), []);
  const projects = useMemo(() => projectsData ?? [], [projectsData]);

  const [expsByProject, setExpsByProject] = useState<Record<number, Experiment[]>>({});
  const [cksByExp, setCksByExp] = useState<Record<number, Checkpoint[]>>({});
  const [infsByExp, setInfsByExp] = useState<Record<number, Inference[]>>({});
  const [openItems, setOpenItems] = useState<Set<TreeItemValue>>(new Set());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [treeError, setTreeError] = useState<string | null>(null);

  // Flat lookups so a selected leaf can resolve its project/experiment context
  // (Inference carries only experiment_id + checkpoint_id, not project_id).
  const projectById = useMemo(() => {
    const m = new Map<number, Project>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);
  const expById = useMemo(() => {
    const m = new Map<number, Experiment>();
    for (const arr of Object.values(expsByProject)) for (const e of arr) m.set(e.id, e);
    return m;
  }, [expsByProject]);
  const ckById = useMemo(() => {
    const m = new Map<number, Checkpoint>();
    for (const arr of Object.values(cksByExp)) for (const c of arr) m.set(c.id, c);
    return m;
  }, [cksByExp]);
  const infById = useMemo(() => {
    const m = new Map<number, Inference>();
    for (const arr of Object.values(infsByExp)) for (const i of arr) m.set(i.id, i);
    return m;
  }, [infsByExp]);

  const setNodeLoading = (key: string, on: boolean) =>
    setLoadingNodes((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const loadExperiments = async (projectId: number) => {
    if (expsByProject[projectId]) return;
    setNodeLoading(`p:${projectId}`, true);
    try {
      const exps = await api.listExperiments(projectId);
      setExpsByProject((prev) => ({ ...prev, [projectId]: exps }));
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setNodeLoading(`p:${projectId}`, false);
    }
  };

  const loadExperimentChildren = async (expId: number) => {
    if (cksByExp[expId] && infsByExp[expId]) return;
    setNodeLoading(`e:${expId}`, true);
    try {
      const [cks, infs] = await Promise.all([
        api.listCheckpoints(expId),
        api.listInferencesByExperiment(expId),
      ]);
      setCksByExp((prev) => ({ ...prev, [expId]: cks }));
      setInfsByExp((prev) => ({ ...prev, [expId]: infs }));
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setNodeLoading(`e:${expId}`, false);
    }
  };

  const handleOpenChange: NonNullable<TreeProps["onOpenChange"]> = (_, data) => {
    setOpenItems(new Set(data.openItems));
    if (!data.open) return;
    const v = String(data.value);
    if (v.startsWith("p:")) void loadExperiments(Number(v.slice(2)));
    else if (v.startsWith("e:")) void loadExperimentChildren(Number(v.slice(2)));
  };

  // --- selection (max 6, preserve order, dedupe) ---
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTED) return prev;
      return [...prev, id];
    });

  const selected = useMemo<InfCtx[]>(() => {
    const out: InfCtx[] = [];
    for (const id of selectedIds) {
      const inf = infById.get(id);
      if (!inf) continue;
      const exp = expById.get(inf.experiment_id);
      const projectId = exp ? exp.project_id : null;
      const projectName =
        projectId != null ? projectById.get(projectId)?.name ?? `#${projectId}` : "—";
      const ck = ckById.get(inf.checkpoint_id);
      out.push({
        inf,
        projectId,
        projectName,
        expName: exp?.name ?? `#${inf.experiment_id}`,
        ckName: ck?.display_name ?? `#${inf.checkpoint_id}`,
      });
    }
    return out;
  }, [selectedIds, infById, expById, ckById, projectById]);

  // --- lazily fetched images, keyed by inference id ---
  const [imagesById, setImagesById] = useState<Record<number, string[]>>({});
  const [imagesLoading, setImagesLoading] = useState<Record<number, boolean>>({});
  const [imagesFailed, setImagesFailed] = useState<Set<number>>(new Set());
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    for (const c of selected) {
      const id = c.inf.id;
      if (imagesById[id] !== undefined || imagesLoading[id] || imagesFailed.has(id)) continue;
      setImagesLoading((prev) => ({ ...prev, [id]: true }));
      api
        .getInferenceImages(id)
        .then((res) => setImagesById((prev) => ({ ...prev, [id]: res.images })))
        // Record a failure (distinct from an empty result) so the UI can offer
        // a retry instead of permanently caching [] for a transient error.
        .catch(() => setImagesFailed((prev) => new Set(prev).add(id)))
        .finally(() => setImagesLoading((prev) => ({ ...prev, [id]: false })));
    }
  }, [selected, imagesById, imagesLoading, imagesFailed]);

  const retryImages = (id: number) =>
    setImagesFailed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  // --- AI evaluation (gated: exactly 2 selected within the same project) ---
  const aCtx = selected.length === 2 ? selected[0] : null;
  const bCtx = selected.length === 2 ? selected[1] : null;
  const sameProject =
    !!aCtx && !!bCtx && aCtx.projectId != null && aCtx.projectId === bCtx.projectId;
  const sharedProjectId = sameProject && aCtx ? aCtx.projectId : null;

  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [startingEval, setStartingEval] = useState(false);

  const aId = aCtx?.inf.id ?? null;
  const bId = bCtx?.inf.id ?? null;

  // Preload an existing verdict for the selected pair (best-effort).
  useEffect(() => {
    let cancelled = false;
    setEvaluation(null);
    setEvalError(null);
    if (aId == null || bId == null || !sameProject) return;
    api
      .findEvaluation(aId, bId)
      .then((ev) => {
        if (
          !cancelled &&
          ev &&
          (ev.status === "done" || ev.status === "running" || ev.status === "pending")
        ) {
          setEvaluation(ev);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [aId, bId, sameProject]);

  const evalRunning =
    evaluation !== null &&
    (evaluation.status === "running" || evaluation.status === "pending");

  usePolling(
    () => {
      if (!evaluation) return;
      api
        .getEvaluation(evaluation.id)
        .then(setEvaluation)
        .catch((e) => setEvalError(e instanceof Error ? e.message : String(e)));
    },
    evalRunning,
    2000,
  );

  const runComparison = async () => {
    if (sharedProjectId == null || aId == null || bId == null) return;
    setStartingEval(true);
    setEvalError(null);
    try {
      setEvaluation(await api.createEvaluation(sharedProjectId, aId, bId));
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : String(e));
    } finally {
      setStartingEval(false);
    }
  };

  const winnerInferenceId = useMemo(() => {
    if (!evaluation || evaluation.status !== "done") return null;
    const w = evaluation.result?.winner;
    if (w === "A") return evaluation.inference_a_id;
    if (w === "B") return evaluation.inference_b_id;
    return null;
  }, [evaluation]);

  // A preloaded verdict may be stored in the opposite A/B order than the current
  // selection (findEvaluation matches the pair either way). Re-orient the winner
  // letter and scores to the on-screen columns (A = selected[0], B = selected[1]).
  const orientedEval = useMemo(() => {
    if (!evaluation || evaluation.status !== "done") return null;
    const r = evaluation.result ?? {};
    const storedAisCurrentA = evaluation.inference_a_id === aId;
    return {
      scoreA: storedAisCurrentA ? r.score_a : r.score_b,
      scoreB: storedAisCurrentA ? r.score_b : r.score_a,
      winnerLetter:
        r.winner === "tie"
          ? "tie"
          : winnerInferenceId === aId
            ? "A"
            : winnerInferenceId === bId
              ? "B"
              : null,
    };
  }, [evaluation, aId, bId, winnerInferenceId]);

  // --- tree rendering helpers ---
  const placeholder = (key: string, node: React.ReactNode) => (
    <TreeItem key={key} itemType="leaf" value={key}>
      <TreeItemLayout>
        <span className={mergeClasses(shared.muted, shared.small, s.placeholder)}>{node}</span>
      </TreeItemLayout>
    </TreeItem>
  );

  const renderInferenceLeaf = (inf: Inference) => {
    const selectable = inf.status === "done";
    const checked = selectedIds.includes(inf.id);
    const atMax = !checked && selectedIds.length >= MAX_SELECTED;
    return (
      <TreeItem key={`i:${inf.id}`} itemType="leaf" value={`i:${inf.id}`}>
        <TreeItemLayout aside={<StatusBadge status={inf.status} />}>
          {/* stopPropagation so toggling selection doesn't also drive tree focus */}
          <span className={s.leafCheckbox} onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={checked}
              disabled={!selectable || atMax}
              label={inf.name}
              onChange={() => toggleSelect(inf.id)}
            />
          </span>
        </TreeItemLayout>
      </TreeItem>
    );
  };

  const renderExperimentChildren = (expId: number) => {
    const cks = cksByExp[expId];
    const infs = infsByExp[expId];
    if (!cks || !infs) {
      return placeholder(
        `e:${expId}:ph`,
        loadingNodes.has(`e:${expId}`) ? <Spinner size="tiny" /> : "展开以加载…",
      );
    }
    if (cks.length === 0) return placeholder(`e:${expId}:empty`, "（无检查点）");
    return cks.map((c) => {
      const ckInfs = infs.filter((i) => i.checkpoint_id === c.id);
      return (
        <TreeItem key={`c:${c.id}`} itemType="branch" value={`c:${c.id}`}>
          <TreeItemLayout aside={<StatusBadge status={c.status} />}>
            {c.display_name}
          </TreeItemLayout>
          <Tree>
            {ckInfs.length === 0
              ? placeholder(`c:${c.id}:empty`, "（无推理）")
              : ckInfs.map(renderInferenceLeaf)}
          </Tree>
        </TreeItem>
      );
    });
  };

  const renderProjectChildren = (projectId: number) => {
    const exps = expsByProject[projectId];
    if (!exps) {
      return placeholder(
        `p:${projectId}:ph`,
        loadingNodes.has(`p:${projectId}`) ? <Spinner size="tiny" /> : "展开以加载…",
      );
    }
    if (exps.length === 0) return placeholder(`p:${projectId}:empty`, "（无实验）");
    return exps.map((e) => (
      <TreeItem key={`e:${e.id}`} itemType="branch" value={`e:${e.id}`}>
        <TreeItemLayout>{e.name}</TreeItemLayout>
        <Tree>{renderExperimentChildren(e.id)}</Tree>
      </TreeItem>
    ));
  };

  return (
    <div className={shared.container}>
      <Title3>推理结果</Title3>
      <Body1 className={mergeClasses(shared.muted, shared.small)} style={{ display: "block" }}>
        在左侧树中展开 项目 → 实验 → 检查点 → 推理，勾选已完成的推理（最多 {MAX_SELECTED} 个）进行并排对比。
      </Body1>

      <ErrorBanner error={projectsError ?? treeError} />

      <div className={s.layout}>
        {/* 左侧：层级树 */}
        <div className={s.treePane}>
          {projectsLoading ? (
            <Spinner label="加载中…" />
          ) : projects.length === 0 ? (
            <div className={shared.empty}>还没有项目。</div>
          ) : (
            <Tree aria-label="推理结果层级" openItems={openItems} onOpenChange={handleOpenChange}>
              {projects.map((p) => (
                <TreeItem key={`p:${p.id}`} itemType="branch" value={`p:${p.id}`}>
                  <TreeItemLayout>{p.name}</TreeItemLayout>
                  <Tree>{renderProjectChildren(p.id)}</Tree>
                </TreeItem>
              ))}
            </Tree>
          )}
        </div>

        {/* 右侧：浏览 / 对比 */}
        <div className={s.browsePane}>
          {/* AI 对比面板 */}
          <Card className={s.card}>
            <div className={shared.spread}>
              <Subtitle2>AI 对比</Subtitle2>
              {sameProject && (
                <Button
                  appearance="primary"
                  disabled={startingEval || evalRunning}
                  onClick={() => void runComparison()}
                >
                  {startingEval || evalRunning ? "对比中…" : "用 AI 对比"}
                </Button>
              )}
            </div>

            {selected.length !== 2 ? (
              <Body1 className={mergeClasses(shared.muted, shared.small)}>
                请选择恰好 2 个推理以进行 AI 对比。
              </Body1>
            ) : !sameProject ? (
              <Body1 className={mergeClasses(shared.muted, shared.small)}>
                跨项目仅支持并排查看；AI 评测需同一项目内的 2 个推理。
              </Body1>
            ) : (
              <>
                {aCtx && bCtx && (
                  <Body1 className={mergeClasses(shared.muted, shared.small, s.pair)}>
                    A：<span className={shared.mono}>{aCtx.inf.name}</span> &nbsp;对&nbsp; B：
                    <span className={shared.mono}>{bCtx.inf.name}</span>
                  </Body1>
                )}

                <ErrorBanner error={evalError} />

                {evalRunning && (
                  <div className={s.runningRow}>
                    <Spinner size="tiny" />
                    <Body1 className={shared.small}>正在使用 VLM 评测…</Body1>
                  </div>
                )}

                {evaluation && evaluation.status === "failed" && (
                  <ErrorBanner error={evaluation.error || "评测失败。"} />
                )}

                {evaluation && evaluation.status === "done" && (
                  <Card className={s.resultCard}>
                    <div className={s.resultHead}>
                      <Body1Strong>
                        优胜：
                        {orientedEval?.winnerLetter === "tie"
                          ? "平局"
                          : orientedEval?.winnerLetter && winnerInferenceId != null
                            ? `${orientedEval.winnerLetter} — ${
                                infById.get(winnerInferenceId)?.name ?? `#${winnerInferenceId}`
                              }`
                            : "—"}
                      </Body1Strong>
                      <Badge appearance="filled" color="success">
                        评分：{orientedEval?.scoreA ?? "—"} 比 {orientedEval?.scoreB ?? "—"}
                      </Badge>
                    </div>
                    {evaluation.result?.reason && (
                      <Body1 className={shared.small}>{evaluation.result.reason}</Body1>
                    )}
                  </Card>
                )}
              </>
            )}
          </Card>

          {/* 对比网格 */}
          {selected.length === 0 ? (
            <div className={shared.empty}>在左侧勾选推理以并排对比。</div>
          ) : (
            <div
              className={s.grid}
              style={{
                gridTemplateColumns: `repeat(${Math.min(selected.length, MAX_SELECTED)}, minmax(0,1fr))`,
              }}
            >
              {selected.map((c) => {
                const inf = c.inf;
                const isWinner = winnerInferenceId === inf.id;
                return (
                  <div key={inf.id} className={mergeClasses(s.col, isWinner && s.winnerCol)}>
                    <div className={s.colHead}>
                      <Body1Strong className={shared.mono}>{inf.name}</Body1Strong>
                      {isWinner ? (
                        <Badge appearance="filled" color="success">
                          🏆 优胜
                        </Badge>
                      ) : (
                        <StatusBadge status={inf.status} />
                      )}
                    </div>
                    <Caption1 className={shared.muted}>
                      {c.projectName} / {c.expName} / {c.ckName}
                    </Caption1>
                    <Body1 className={mergeClasses(shared.muted, shared.small)}>
                      {paramsSummary(inf.params)}
                    </Body1>
                    <ImageThumbs
                      inferenceId={inf.id}
                      images={imagesById[inf.id]}
                      loading={!!imagesLoading[inf.id]}
                      failed={imagesFailed.has(inf.id)}
                      onOpen={setLightboxSrc}
                      onRetry={() => retryImages(inf.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
