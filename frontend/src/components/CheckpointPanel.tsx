import { Fragment, useState } from "react";
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
import type { Checkpoint } from "../types";
import { useAsync, usePolling } from "../hooks";
import { useSharedStyles } from "../theme/sharedStyles";
import {
  ConfirmButton,
  ErrorBanner,
  Modal,
  Spinner,
  StatusBadge,
  formatBytes,
} from "./ui";

const DELETE_MESSAGE =
  "删除该检查点？这将永久删除已拷贝的文件以及依赖它的推理结果。";

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalM,
  },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalL,
  },
  section: { marginTop: tokens.spacingVerticalXL },
  metadata: { marginTop: tokens.spacingVerticalS },
  metadataKv: { marginTop: tokens.spacingVerticalS },
  cardKv: { marginTop: tokens.spacingVerticalS },
  cardMessage: { marginTop: tokens.spacingVerticalS },
  cardActions: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: tokens.spacingHorizontalS,
    rowGap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalM,
  },
});

function sourceLabel(c: Checkpoint): string {
  return `${c.source_host ? `${c.source_host}:` : ""}${c.source_path}`;
}

function CopyCheckpointModal({
  open,
  experimentId,
  onClose,
  onCreated,
}: {
  open: boolean;
  experimentId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const s = useStyles();
  const shared = useSharedStyles();
  const { data: servers } = useAsync(() => api.listServers(), []);
  const [displayName, setDisplayName] = useState("");
  const [sourceHost, setSourceHost] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [serverId, setServerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDisplayName("");
    setSourceHost("");
    setSourcePath("");
    setServerId("");
    setError(null);
    setSaving(false);
  };

  // Picking a saved server prefills host + path (still editable below).
  const pickServer = (id: string) => {
    setServerId(id);
    const srv = (servers ?? []).find((x) => String(x.id) === id);
    if (srv) {
      setSourceHost(srv.host);
      setSourcePath(srv.default_path);
    }
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !sourcePath.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.createCheckpoint(experimentId, {
        display_name: displayName.trim(),
        source_host: sourceHost.trim(),
        source_path: sourcePath.trim(),
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="拷贝检查点">
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <Field label="显示名称" required>
          <Input
            value={displayName}
            autoFocus
            required
            placeholder="epoch-50"
            onChange={(_, data) => setDisplayName(data.value)}
          />
        </Field>
        {servers && servers.length > 0 && (
          <Field label="从服务器选择（可选）">
            <Select value={serverId} onChange={(_, data) => pickServer(data.value)}>
              <option value="">手动输入…</option>
              {servers.map((srv) => (
                <option key={srv.id} value={String(srv.id)}>
                  {srv.name}
                  {srv.host ? ` (${srv.host})` : "（本地）"}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="SSH 主机(user@host) — 留空则从本地路径拷贝">
          <Input
            value={sourceHost}
            placeholder="user@gpu-box"
            onChange={(_, data) => {
              setServerId("");
              setSourceHost(data.value);
            }}
          />
        </Field>
        <Field label="源路径" required>
          <Input
            value={sourcePath}
            required
            placeholder="/data/checkpoints/run1"
            className={shared.mono}
            onChange={(_, data) => setSourcePath(data.value)}
          />
        </Field>
        <div className={s.actions}>
          <Button type="button" onClick={close} disabled={saving}>
            取消
          </Button>
          <Button
            type="submit"
            appearance="primary"
            disabled={saving || !displayName.trim() || !sourcePath.trim()}
          >
            {saving ? "正在开始拷贝…" : "拷贝检查点"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RenameCheckpointModal({
  checkpoint,
  onClose,
  onRenamed,
}: {
  checkpoint: Checkpoint | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const s = useStyles();
  const [name, setName] = useState(checkpoint?.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkpoint || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateCheckpoint(checkpoint.id, name.trim());
      onRenamed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={!!checkpoint} onClose={onClose} title="重命名检查点">
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <Field label="显示名称" required>
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

function MetadataSection({ metadata }: { metadata: Record<string, unknown> }) {
  const s = useStyles();
  const shared = useSharedStyles();
  const [open, setOpen] = useState(false);
  const entries = Object.entries(metadata ?? {});
  if (entries.length === 0) return null;
  return (
    <div className={s.metadata}>
      <Button size="small" onClick={() => setOpen((o) => !o)}>
        {open ? "隐藏 config.yaml" : `config.yaml (${entries.length} 个键)`}
      </Button>
      {open && (
        <div className={`${shared.kv} ${s.metadataKv}`}>
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
    </div>
  );
}

export default function CheckpointPanel({ experimentId }: { experimentId: number }) {
  const s = useStyles();
  const shared = useSharedStyles();
  const { data, loading, error, reload } = useAsync(
    () => api.listCheckpoints(experimentId),
    [experimentId],
  );
  const [copyOpen, setCopyOpen] = useState(false);
  const [renaming, setRenaming] = useState<Checkpoint | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasActive = !!data?.some(
    (c) => c.status === "pending" || c.status === "copying",
  );
  usePolling(reload, hasActive, 2000);

  const handleRecopy = async (id: number) => {
    setActionError(null);
    try {
      await api.recopyCheckpoint(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: number) => {
    setActionError(null);
    try {
      await api.deleteCheckpoint(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className={s.section}>
      <div className={`${shared.toolbar} ${shared.spread}`}>
        <Subtitle2>检查点</Subtitle2>
        <Button appearance="primary" icon={<Add20Regular />} onClick={() => setCopyOpen(true)}>
          拷贝检查点
        </Button>
      </div>

      <ErrorBanner error={error ?? actionError} />

      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <div className={shared.empty}>还没有检查点，拷贝一个开始吧。</div>
      ) : (
        <div className={shared.col}>
          {data.map((c) => (
            <Card key={c.id}>
              <div className={s.header}>
                <Body1Strong>{c.display_name}</Body1Strong>
                <StatusBadge status={c.status} />
              </div>
              <div className={`${shared.kv} ${s.cardKv}`}>
                <span className={shared.kvKey}>来源</span>
                <span className={shared.kvVal}>{sourceLabel(c)}</span>
                <span className={shared.kvKey}>大小</span>
                <span>{formatBytes(c.size_bytes)}</span>
              </div>
              {c.message && (
                <p className={`${shared.muted} ${shared.small} ${s.cardMessage}`}>
                  {c.message}
                </p>
              )}
              <MetadataSection metadata={c.metadata} />
              <div className={s.cardActions}>
                <Button size="small" onClick={() => setRenaming(c)}>
                  重命名
                </Button>
                {(c.status === "failed" || c.status === "ready") && (
                  <Button size="small" onClick={() => handleRecopy(c.id)}>
                    重新拷贝
                  </Button>
                )}
                <ConfirmButton message={DELETE_MESSAGE} onConfirm={() => handleDelete(c.id)}>
                  删除
                </ConfirmButton>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CopyCheckpointModal
        open={copyOpen}
        experimentId={experimentId}
        onClose={() => setCopyOpen(false)}
        onCreated={() => {
          setCopyOpen(false);
          void reload();
        }}
      />
      <RenameCheckpointModal
        key={renaming?.id ?? "none"}
        checkpoint={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={() => {
          setRenaming(null);
          void reload();
        }}
      />
    </section>
  );
}
