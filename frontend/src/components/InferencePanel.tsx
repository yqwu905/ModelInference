import { useEffect, useState } from "react";
import { Fragment } from "react";
import {
  Body1Strong,
  Button,
  Card,
  Field,
  Input,
  Select,
  Subtitle2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular } from "@fluentui/react-icons";
import { api } from "../api";
import type { Checkpoint, Inference, ParamDef, Project } from "../types";
import { useAsync, usePolling } from "../hooks";
import {
  ConfirmButton,
  ErrorBanner,
  Lightbox,
  Modal,
  Spinner,
  StatusBadge,
} from "./ui";
import { useSharedStyles } from "../theme/sharedStyles";

const DELETE_MESSAGE = "删除该推理？这将永久删除其输出图片。";

const useStyles = makeStyles({
  actions: {
    display: "flex",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalL,
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalM,
  },
  hint: {
    marginTop: `calc(-1 * ${tokens.spacingVerticalM})`,
    marginBottom: tokens.spacingVerticalL,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

function paramDefault(def: ParamDef): string {
  return String(def.default ?? "");
}

function ImagesModal({
  inference,
  onClose,
}: {
  inference: Inference | null;
  onClose: () => void;
}) {
  const shared = useSharedStyles();
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!inference) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setImages([]);
    api
      .getInferenceImages(inference.id)
      .then((res) => {
        if (!cancelled) setImages(res.images);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inference]);

  return (
    <Modal
      open={!!inference}
      onClose={onClose}
      wide
      title={inference ? `图片 — ${inference.name}` : "图片"}
    >
      <ErrorBanner error={error} />
      {loading ? (
        <Spinner />
      ) : images.length === 0 ? (
        <div className={shared.empty}>暂无图片</div>
      ) : (
        <div className={shared.thumbs}>
          {images.map((src) => (
            <img
              key={src}
              className={shared.thumbImg}
              src={src}
              alt=""
              onClick={() => setLightbox(src)}
            />
          ))}
        </div>
      )}
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </Modal>
  );
}

function RenameInferenceModal({
  inference,
  onClose,
  onRenamed,
}: {
  inference: Inference | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const s = useStyles();
  const [name, setName] = useState(inference?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inference || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateInference(inference.id, name.trim());
      onRenamed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={!!inference} onClose={onClose} title="重命名推理">
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <Field label="名称" required>
          <Input
            value={name}
            autoFocus
            required
            onChange={(_, data) => setName(data.value)}
          />
        </Field>
        <div className={s.actions}>
          <Button type="button" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" appearance="primary" disabled={saving || !name.trim()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RunInferenceModal({
  open,
  project,
  readyCheckpoints,
  defaultName,
  onClose,
  onCreated,
}: {
  open: boolean;
  project: Project;
  readyCheckpoints: Checkpoint[];
  defaultName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const s = useStyles();
  const schema = project.inference_param_schema;
  const [checkpointId, setCheckpointId] = useState<number | "">(
    readyCheckpoints[0]?.id ?? "",
  );
  const [name, setName] = useState(defaultName);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(schema.map((def) => [def.name, paramDefault(def)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkpointId === "" || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {};
      for (const def of schema) {
        if (def.type === "number") {
          // 空白/非法数字一律跳过，而不是发送 0（Number("")）或
          // null（Number("abc")）；后端会因此保留其 {token} 占位符。
          const trimmed = (values[def.name] ?? "").trim();
          if (trimmed === "") continue;
          const n = Number(trimmed);
          if (Number.isNaN(n)) continue;
          params[def.name] = n;
        } else {
          params[def.name] = values[def.name] ?? "";
        }
      }
      await api.createInference(checkpointId, { name: name.trim(), params });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="运行推理">
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <Field label="检查点" required>
          <Select
            value={checkpointId === "" ? "" : String(checkpointId)}
            required
            onChange={(_, data) =>
              setCheckpointId(data.value ? Number(data.value) : "")
            }
          >
            {readyCheckpoints.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.display_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="名称" required>
          <Input
            value={name}
            required
            onChange={(_, data) => setName(data.value)}
          />
        </Field>
        {schema.map((def) => {
          const value = values[def.name] ?? "";
          const onChange = (v: string) =>
            setValues((prev) => ({ ...prev, [def.name]: v }));
          return (
            <Field label={def.label} key={def.name}>
              {def.type === "select" ? (
                <Select value={value} onChange={(_, data) => onChange(data.value)}>
                  {(def.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </Select>
              ) : def.type === "number" ? (
                <Input
                  type="number"
                  value={value}
                  onChange={(_, data) => onChange(data.value)}
                />
              ) : (
                <Input
                  type="text"
                  value={value}
                  onChange={(_, data) => onChange(data.value)}
                />
              )}
            </Field>
          );
        })}
        <div className={s.actions}>
          <Button type="button" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            type="submit"
            appearance="primary"
            disabled={saving || checkpointId === "" || !name.trim()}
          >
            {saving ? "开始中…" : "运行推理"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function InferenceCard({
  inference,
  onViewImages,
  onRename,
  onDelete,
}: {
  inference: Inference;
  onViewImages: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const s = useStyles();
  const shared = useSharedStyles();
  const [showLog, setShowLog] = useState(false);
  const entries = Object.entries(inference.params);
  return (
    <Card>
      <div className={s.cardHeader}>
        <Body1Strong>{inference.name}</Body1Strong>
        <StatusBadge status={inference.status} />
      </div>
      {entries.length > 0 && (
        <div className={shared.kv}>
          {entries.map(([k, v]) => (
            <Fragment key={k}>
              <span className={shared.kvKey}>{k}</span>
              <span className={shared.kvVal}>
                {typeof v === "string" ? v : JSON.stringify(v)}
              </span>
            </Fragment>
          ))}
        </div>
      )}
      <div className={shared.btnRow}>
        <Button size="small" onClick={onViewImages}>
          查看图片
        </Button>
        <Button size="small" onClick={() => setShowLog((prev) => !prev)}>
          {showLog ? "隐藏日志" : "日志"}
        </Button>
        <Button size="small" onClick={onRename}>
          重命名
        </Button>
        <ConfirmButton message={DELETE_MESSAGE} onConfirm={onDelete}>
          删除
        </ConfirmButton>
      </div>
      {showLog && (
        <pre className={shared.log}>{inference.log || "（暂无日志输出）"}</pre>
      )}
    </Card>
  );
}

export default function InferencePanel({
  experimentId,
  project,
}: {
  experimentId: number;
  project: Project;
}) {
  const shared = useSharedStyles();
  const s = useStyles();
  const {
    data: inferences,
    loading: inferencesLoading,
    error: inferencesError,
    reload: reloadInferences,
  } = useAsync(() => api.listInferencesByExperiment(experimentId), [experimentId]);
  const {
    data: checkpoints,
    error: checkpointsError,
    reload: reloadCheckpoints,
  } = useAsync(() => api.listCheckpoints(experimentId), [experimentId]);

  const [runOpen, setRunOpen] = useState(false);
  const [viewing, setViewing] = useState<Inference | null>(null);
  const [renaming, setRenaming] = useState<Inference | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const anyRunning = !!inferences?.some(
    (i) => i.status === "running" || i.status === "pending",
  );
  usePolling(reloadInferences, anyRunning, 2000);

  const readyCheckpoints = (checkpoints ?? []).filter((c) => c.status === "ready");
  const canRun = readyCheckpoints.length > 0;

  const handleDelete = async (id: number) => {
    setActionError(null);
    try {
      await api.deleteInference(id);
      await reloadInferences();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const defaultName = `run-${(inferences?.length ?? 0) + 1}`;

  return (
    <section>
      <div className={`${shared.toolbar} ${shared.spread}`}>
        <Subtitle2>推理</Subtitle2>
        <Button
          appearance="primary"
          icon={<Add20Regular />}
          disabled={!canRun}
          onClick={() => {
            void reloadCheckpoints();
            setRunOpen(true);
          }}
        >
          运行推理
        </Button>
      </div>

      {!canRun && (
        <p className={s.hint}>请先拷贝一个检查点并等待其就绪，然后才能运行推理。</p>
      )}

      <ErrorBanner error={inferencesError ?? checkpointsError ?? actionError} />

      {inferencesLoading ? (
        <Spinner />
      ) : !inferences || inferences.length === 0 ? (
        <div className={shared.empty}>还没有推理。</div>
      ) : (
        <div className={shared.col}>
          {inferences.map((inf) => (
            <InferenceCard
              key={inf.id}
              inference={inf}
              onViewImages={() => setViewing(inf)}
              onRename={() => setRenaming(inf)}
              onDelete={() => handleDelete(inf.id)}
            />
          ))}
        </div>
      )}

      {runOpen && (
        <RunInferenceModal
          open={runOpen}
          project={project}
          readyCheckpoints={readyCheckpoints}
          defaultName={defaultName}
          onClose={() => setRunOpen(false)}
          onCreated={() => {
            setRunOpen(false);
            void reloadInferences();
          }}
        />
      )}
      <ImagesModal inference={viewing} onClose={() => setViewing(null)} />
      <RenameInferenceModal
        key={renaming?.id ?? "none"}
        inference={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={() => {
          setRenaming(null);
          void reloadInferences();
        }}
      />
    </section>
  );
}
