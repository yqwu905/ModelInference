import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Body1,
  Body1Strong,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Button,
  Card,
  Subtitle2,
  Title3,
  ToggleButton,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { api } from "../api";
import type { Evaluation, Inference } from "../types";
import { useAsync, usePolling } from "../hooks";
import { useSharedStyles } from "../theme/sharedStyles";
import {
  ErrorBanner,
  Lightbox,
  Spinner,
  StatusBadge,
  formatDate,
} from "../components/ui";

const MAX_SELECTED = 6;

const useStyles = makeStyles({
  card: { marginBottom: tokens.spacingVerticalL },
  selectRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
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
  grid: {
    display: "grid",
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
  },
  col: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
  },
  winnerCol: {
    border: `2px solid ${tokens.colorPaletteGreenBorder2}`,
  },
  colHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  pastList: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalM,
  },
});

/** 紧凑地渲染推理的 params 对象。 */
function paramsSummary(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return "无参数";
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
  const shared = useSharedStyles();
  if (loading) return <Spinner size="tiny" />;
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

export default function ComparePage() {
  const params = useParams();
  const navigate = useNavigate();
  const shared = useSharedStyles();
  const s = useStyles();
  const experimentId = Number(params.experimentId);

  // --- 核心数据加载 ---
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

  // --- 选择状态 ---
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // --- 懒加载的图片缓存，按推理 id 键控 ---
  const [imagesById, setImagesById] = useState<Record<number, string[]>>({});
  const [imagesLoading, setImagesLoading] = useState<Record<number, boolean>>(
    {},
  );

  // --- 灯箱 ---
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // --- AI 评测状态 ---
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [startingEval, setStartingEval] = useState(false);

  // --- 历史评测 ---
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

  // 仅保留仍存在且已完成的 id；保持选择顺序。
  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => inferenceById.get(id))
        .filter((inf): inf is Inference => inf !== undefined),
    [selectedIds, inferenceById],
  );

  // 为任何尚未缓存的已选推理拉取图片。
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
    // 选择发生变化会使任何进行中的判定失效。
    setEvaluation(null);
    setEvalError(null);
  };

  // 恰好选择两个时驱动 AI 对比。
  const pairA = selected.length === 2 ? selected[0] : null;
  const pairB = selected.length === 2 ? selected[1] : null;

  // 为所选配对预载已存在的判定（尽力而为）。
  useEffect(() => {
    let cancelled = false;
    setEvaluation(null);
    setEvalError(null);
    if (!pairA || !pairB) return;
    api
      .findEvaluation(pairA.id, pairB.id)
      .then((ev) => {
        // 采用一个终态判定（用于展示）或一个进行中的判定（让轮询器恢复它），
        // 而不是悄悄地启动一个重复评测。
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

  // 轮询运行中的评测直到终态。
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

  // 用评测自身的 inference_a_id/inference_b_id（而非当前选择顺序，预载先前判定时可能反转）
  // 把评测的优胜者（"A"/"B"）映射到一个推理 id。
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

  // --- 渲染 ---
  const topError = experimentError || projectError;

  if (loadingExperiment) {
    return (
      <div className={shared.container}>
        <Spinner label="加载中…" />
      </div>
    );
  }

  if (topError || !experiment) {
    return (
      <div className={shared.container}>
        <ErrorBanner error={topError || "未找到实验。"} />
      </div>
    );
  }

  return (
    <div className={shared.container}>
      <Breadcrumb>
        {project ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbButton onClick={() => navigate(`/projects/${project.id}`)}>
                {project.name}
              </BreadcrumbButton>
            </BreadcrumbItem>
            <BreadcrumbDivider />
          </>
        ) : null}
        <BreadcrumbItem>
          <BreadcrumbButton onClick={() => navigate(`/experiments/${experimentId}`)}>
            {experiment.name}
          </BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>对比</BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <div className={`${shared.toolbar} ${shared.spread}`}>
        <Title3>对比推理</Title3>
      </div>

      <ErrorBanner error={inferencesError} />

      {loadingInferences ? (
        <Spinner label="加载中…" />
      ) : doneInferences.length === 0 ? (
        <div className={shared.empty}>
          还没有完成的推理，请先运行一些推理。
        </div>
      ) : (
        <>
          {/* 选择器 */}
          <Card className={s.card}>
            <div className={shared.spread}>
              <Subtitle2>
                选择推理 ({selected.length}/{MAX_SELECTED})
              </Subtitle2>
              {selected.length >= MAX_SELECTED && (
                <Body1 className={mergeClasses(shared.muted, shared.small)}>最多 6 个</Body1>
              )}
            </div>
            <div className={s.selectRow}>
              {doneInferences.map((inf) => {
                const isSelected = selectedIds.includes(inf.id);
                const atMax =
                  !isSelected && selected.length >= MAX_SELECTED;
                return (
                  <ToggleButton
                    key={inf.id}
                    size="small"
                    checked={isSelected}
                    disabled={atMax}
                    title={paramsSummary(inf.params)}
                    onClick={() => toggleSelect(inf.id)}
                  >
                    {inf.name}
                  </ToggleButton>
                );
              })}
            </div>
          </Card>

          {/* AI 对比面板 */}
          <Card className={s.card}>
            <div className={shared.spread}>
              <Subtitle2>AI 对比</Subtitle2>
              {selected.length === 2 && (
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
            ) : (
              <>
                {pairA && pairB && (
                  <Body1 className={mergeClasses(shared.muted, shared.small, s.pair)}>
                    A：<span className={shared.mono}>{pairA.name}</span> &nbsp;对&nbsp;
                    B：<span className={shared.mono}>{pairB.name}</span>
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
                  <>
                    <ErrorBanner
                      error={evaluation.error || "评测失败。"}
                    />
                    {evaluation.error
                      ?.toLowerCase()
                      .includes("vlm not configured") &&
                      project && (
                        <Body1 className={shared.small}>
                          <Button
                            appearance="transparent"
                            onClick={() => navigate(`/projects/${project.id}`)}
                          >
                            前往配置 VLM
                          </Button>
                          为本项目配置后请重试。
                        </Body1>
                      )}
                  </>
                )}

                {evaluation && evaluation.status === "done" && (
                  <Card className={s.resultCard}>
                    <div className={s.resultHead}>
                      <Body1Strong>
                        优胜：
                        {evaluation.result?.winner === "tie"
                          ? "平局"
                          : winnerInferenceId != null
                            ? `${evaluation.result?.winner} — ${
                                winnerInf?.name ?? `#${winnerInferenceId}`
                              }`
                            : "—"}
                      </Body1Strong>
                      <Badge appearance="filled" color="success">
                        评分：{evaluation.result?.score_a ?? "—"} 比{" "}
                        {evaluation.result?.score_b ?? "—"}
                      </Badge>
                    </div>
                    {evaluation.result?.reason && (
                      <Body1 className={shared.small}>
                        {evaluation.result.reason}
                      </Body1>
                    )}
                  </Card>
                )}
              </>
            )}
          </Card>

          {/* 对比网格 */}
          {selected.length === 0 ? (
            <div className={shared.empty}>
              在上方选择推理以并排对比。
            </div>
          ) : (
            <div
              className={s.grid}
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
                    className={mergeClasses(s.col, isWinner && s.winnerCol)}
                  >
                    <div className={s.colHead}>
                      <Body1Strong className={shared.mono}>{inf.name}</Body1Strong>
                      {isWinner ? (
                        <Badge appearance="filled" color="success">
                          🏆 优胜{winnerScore != null ? ` ${winnerScore}` : ""}
                        </Badge>
                      ) : (
                        <StatusBadge status={inf.status} />
                      )}
                    </div>
                    <Body1 className={mergeClasses(shared.muted, shared.small)}>
                      {paramsSummary(inf.params)}
                    </Body1>
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

          {/* 历史评测 */}
          {pastEvaluations && pastEvaluations.length > 0 && (
            <Card className={s.card}>
              <Subtitle2>历史评测</Subtitle2>
              <div className={s.pastList}>
                {pastEvaluations.map((ev) => {
                  const a = inferenceById.get(ev.inference_a_id);
                  const b = inferenceById.get(ev.inference_b_id);
                  return (
                    <div key={ev.id} className={shared.kv}>
                      <span className={shared.kvKey}>时间</span>
                      <span className={shared.kvVal}>{formatDate(ev.created_at)}</span>
                      <span className={shared.kvKey}>配对</span>
                      <span className={shared.kvVal}>
                        {a?.name ?? `#${ev.inference_a_id}`} 对{" "}
                        {b?.name ?? `#${ev.inference_b_id}`}
                      </span>
                      <span className={shared.kvKey}>状态</span>
                      <span className={shared.kvVal}>
                        <StatusBadge status={ev.status} />
                      </span>
                      {ev.status === "done" && (
                        <>
                          <span className={shared.kvKey}>优胜</span>
                          <span className={shared.kvVal}>
                            {ev.result?.winner ?? "—"}
                            {ev.result?.score_a != null ||
                            ev.result?.score_b != null
                              ? ` (${ev.result?.score_a ?? "—"} 比 ${
                                  ev.result?.score_b ?? "—"
                                })`
                              : ""}
                          </span>
                          {ev.result?.reason && (
                            <Fragment>
                              <span className={shared.kvKey}>理由</span>
                              <span className={mergeClasses(shared.kvVal, shared.muted)}>
                                {ev.result.reason}
                              </span>
                            </Fragment>
                          )}
                        </>
                      )}
                      {ev.status === "failed" && ev.error && (
                        <>
                          <span className={shared.kvKey}>错误</span>
                          <span className={mergeClasses(shared.kvVal, shared.muted)}>{ev.error}</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}

      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
