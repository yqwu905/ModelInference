import { useState } from "react";
import {
  Badge,
  Body1Strong,
  Button,
  Card,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Tab,
  TabList,
  Textarea,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular, Delete20Regular } from "@fluentui/react-icons";
import { api } from "../api";
import type {
  InferenceEngine,
  InferenceEngineInput,
  ServerConfig,
  ServerInput,
  VlmPreset,
  VlmPresetInput,
  VlmTestResult,
} from "../types";
import { useAsync } from "../hooks";
import { useSharedStyles } from "../theme/sharedStyles";
import { ConfirmButton, ErrorBanner, Modal, Spinner, formatDate } from "../components/ui";

type TabValue = "servers" | "vlm" | "engines";

const useStyles = makeStyles({
  tabs: { marginBottom: tokens.spacingVerticalL },
  cardHeader: {
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
  kvRow: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalS,
  },
  kvInput: { flexGrow: 1 },
  testBar: { marginTop: tokens.spacingVerticalS },
});

/** One-line summary of a VLM test result for the status bar. */
function summarizeVlmTest(r: VlmTestResult): string {
  if (!r.ok) return r.message;
  const parts = [r.message];
  if (r.latency_ms != null) parts.push(`${r.latency_ms}ms`);
  if (r.model) parts.push(`模型 ${r.model}`);
  if (r.reply) parts.push(`回复「${r.reply}」`);
  return parts.join(" · ");
}

export default function SettingsPage() {
  const shared = useSharedStyles();
  const s = useStyles();
  const [tab, setTab] = useState<TabValue>("servers");

  return (
    <div className={shared.container}>
      <Title3>设置</Title3>
      <TabList
        className={s.tabs}
        selectedValue={tab}
        onTabSelect={(_, d) => setTab(d.value as TabValue)}
      >
        <Tab value="servers">服务器</Tab>
        <Tab value="vlm">VLM</Tab>
        <Tab value="engines">推理工程</Tab>
      </TabList>

      {tab === "servers" ? <ServersTab /> : tab === "vlm" ? <VlmTab /> : <EnginesTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 服务器
// ---------------------------------------------------------------------------

function ServersTab() {
  const shared = useSharedStyles();
  const s = useStyles();
  const { data, loading, error, reload } = useAsync(() => api.listServers(), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServerConfig | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDelete = async (id: number) => {
    setActionError(null);
    try {
      await api.deleteServer(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div className={shared.toolbar}>
        <Button appearance="primary" icon={<Add20Regular />} onClick={() => setCreating(true)}>
          新建服务器
        </Button>
      </div>

      <p className={`${shared.muted} ${shared.small}`} style={{ marginTop: 0 }}>
        服务器用于在拷贝检查点时快速选取来源主机与路径；如填写 SSH
        密码，拷贝时将通过 sshpass 进行密码认证，否则使用 SSH 密钥。
      </p>

      <ErrorBanner error={error ?? actionError} />

      {loading ? (
        <Spinner label="加载中…" />
      ) : !data || data.length === 0 ? (
        <div className={shared.empty}>还没有服务器，点击上方新建一个吧。</div>
      ) : (
        <div className={shared.col}>
          {data.map((srv) => (
            <Card key={srv.id}>
              <div className={s.cardHeader}>
                <Body1Strong>{srv.name}</Body1Strong>
                <Badge appearance="outline" color="informative">
                  {formatDate(srv.created_at)}
                </Badge>
              </div>
              <div className={shared.kv}>
                <span className={shared.kvKey}>主机</span>
                <span className={shared.kvVal}>{srv.host || "（本地）"}</span>
                {srv.host && (
                  <>
                    <span className={shared.kvKey}>端口</span>
                    <span className={shared.kvVal}>{srv.port}</span>
                  </>
                )}
                <span className={shared.kvKey}>默认路径</span>
                <span className={shared.kvVal}>{srv.default_path || "—"}</span>
                <span className={shared.kvKey}>认证</span>
                <span className={shared.kvVal}>
                  {srv.password_set ? "已保存密码" : "SSH 密钥"}
                </span>
                {srv.description && (
                  <>
                    <span className={shared.kvKey}>描述</span>
                    <span className={shared.kvVal}>{srv.description}</span>
                  </>
                )}
              </div>
              <div className={shared.btnRow}>
                <Button size="small" onClick={() => setEditing(srv)}>
                  编辑
                </Button>
                <ConfirmButton
                  message={`删除服务器「${srv.name}」？`}
                  onConfirm={() => handleDelete(srv.id)}
                >
                  删除
                </ConfirmButton>
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <ServerModal
          title="新建服务器"
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            await api.createServer(input);
            await reload();
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <ServerModal
          title="编辑服务器"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            await api.updateServer(editing.id, input);
            await reload();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ServerModal(props: {
  title: string;
  initial?: ServerConfig;
  onClose: () => void;
  onSubmit: (input: ServerInput) => Promise<void>;
}) {
  const { title, initial, onClose, onSubmit } = props;
  const shared = useSharedStyles();
  const s = useStyles();
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [defaultPath, setDefaultPath] = useState(initial?.default_path ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) {
      setError("名称为必填项。");
      return;
    }
    const portNum = parseInt(port, 10);
    if (port.trim() && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)) {
      setError("端口需为 1–65535 之间的整数。");
      return;
    }
    const payload: ServerInput = {
      name: name.trim(),
      host: host.trim(),
      // Empty/invalid falls back to the default ssh port.
      port: port.trim() ? portNum : 22,
      default_path: defaultPath.trim(),
      description: description.trim(),
    };
    // Only send the password when the user typed one, so editing without
    // retyping keeps the existing secret (backend treats omitted as "keep").
    if (password) payload.password = password;

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={handleSubmit}>
        <ErrorBanner error={error} />
        <Field label="名称" required>
          <Input
            value={name}
            autoFocus
            placeholder="GPU 服务器 A"
            onChange={(_, d) => setName(d.value)}
          />
        </Field>
        <Field label="SSH 主机 (user@host) — 留空表示本地">
          <Input
            value={host}
            placeholder="user@gpu-box"
            className={shared.mono}
            onChange={(_, d) => setHost(d.value)}
          />
        </Field>
        <Field label="SSH 端口" hint="默认 22；仅本地拷贝时忽略。">
          <Input
            type="number"
            value={port}
            placeholder="22"
            className={shared.mono}
            onChange={(_, d) => setPort(d.value)}
          />
        </Field>
        <Field label="默认路径">
          <Input
            value={defaultPath}
            placeholder="/data/checkpoints"
            className={shared.mono}
            onChange={(_, d) => setDefaultPath(d.value)}
          />
        </Field>
        <Field
          label="SSH 密码"
          hint="可选。填写后拷贝检查点时通过 sshpass 进行密码认证（需服务器安装 sshpass）；留空则使用 SSH 密钥。"
        >
          <Input
            type="password"
            value={password}
            placeholder={
              initial?.password_set ? "已配置——留空则保持不变" : "留空表示不使用密码"
            }
            onChange={(_, d) => setPassword(d.value)}
          />
        </Field>
        <Field label="描述">
          <Textarea
            value={description}
            resize="vertical"
            placeholder="可选描述"
            onChange={(_, d) => setDescription(d.value)}
          />
        </Field>
        <div className={s.actions}>
          <Button type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" appearance="primary" disabled={submitting || !name.trim()}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// VLM
// ---------------------------------------------------------------------------

function VlmTab() {
  const shared = useSharedStyles();
  const s = useStyles();
  const { data, loading, error, reload } = useAsync(() => api.listVlmPresets(), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<VlmPreset | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, VlmTestResult>>({});

  const handleDelete = async (id: number) => {
    setActionError(null);
    try {
      await api.deleteVlmPreset(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const res = await api.testVlmPreset(id);
      setTestResults((prev) => ({ ...prev, [id]: res }));
    } catch (err) {
      // A transport-level failure (e.g. the backend 404s the preset); surface
      // it in the same status bar as a normal failed result.
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div>
      <div className={shared.toolbar}>
        <Button appearance="primary" icon={<Add20Regular />} onClick={() => setCreating(true)}>
          新建 VLM 预设
        </Button>
      </div>

      <p className={`${shared.muted} ${shared.small}`} style={{ marginTop: 0 }}>
        VLM 预设可在项目配置中一键导入，用于 AI 评测（兼容任意 OpenAI 格式接口）。
      </p>

      <ErrorBanner error={error ?? actionError} />

      {loading ? (
        <Spinner label="加载中…" />
      ) : !data || data.length === 0 ? (
        <div className={shared.empty}>还没有 VLM 预设，点击上方新建一个吧。</div>
      ) : (
        <div className={shared.col}>
          {data.map((preset) => (
            <Card key={preset.id}>
              <div className={s.cardHeader}>
                <Body1Strong>{preset.name}</Body1Strong>
                <Badge
                  appearance="outline"
                  color={preset.api_key_set ? "success" : "warning"}
                >
                  {preset.api_key_set ? "已配置密钥" : "无密钥"}
                </Badge>
              </div>
              <div className={shared.kv}>
                <span className={shared.kvKey}>接口地址</span>
                <span className={shared.kvVal}>{preset.base_url || "—"}</span>
                <span className={shared.kvKey}>模型</span>
                <span className={shared.kvVal}>{preset.model || "—"}</span>
              </div>
              <div className={shared.btnRow}>
                <Button
                  size="small"
                  disabled={testingId === preset.id}
                  onClick={() => handleTest(preset.id)}
                >
                  {testingId === preset.id ? "测试中…" : "测试"}
                </Button>
                <Button size="small" onClick={() => setEditing(preset)}>
                  编辑
                </Button>
                <ConfirmButton
                  message={`删除 VLM 预设「${preset.name}」？`}
                  onConfirm={() => handleDelete(preset.id)}
                >
                  删除
                </ConfirmButton>
              </div>
              {testResults[preset.id] && (
                <MessageBar
                  className={s.testBar}
                  intent={testResults[preset.id].ok ? "success" : "error"}
                >
                  <MessageBarBody>
                    {summarizeVlmTest(testResults[preset.id])}
                  </MessageBarBody>
                </MessageBar>
              )}
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <VlmPresetModal
          title="新建 VLM 预设"
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            await api.createVlmPreset(input);
            await reload();
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <VlmPresetModal
          title="编辑 VLM 预设"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            await api.updateVlmPreset(editing.id, input);
            await reload();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function VlmPresetModal(props: {
  title: string;
  initial?: VlmPreset;
  onClose: () => void;
  onSubmit: (input: VlmPresetInput) => Promise<void>;
}) {
  const { title, initial, onClose, onSubmit } = props;
  const s = useStyles();
  const [name, setName] = useState(initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) {
      setError("名称为必填项。");
      return;
    }
    const payload: VlmPresetInput = {
      name: name.trim(),
      base_url: baseUrl.trim(),
      model: model.trim(),
    };
    // Only send the key when the user typed one, so editing without retyping
    // keeps the existing secret (backend treats omitted as "keep").
    if (apiKey.trim()) payload.api_key = apiKey;

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={handleSubmit}>
        <ErrorBanner error={error} />
        <Field label="名称" required>
          <Input
            value={name}
            autoFocus
            placeholder="OpenAI gpt-4o"
            onChange={(_, d) => setName(d.value)}
          />
        </Field>
        <Field label="接口地址">
          <Input
            value={baseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(_, d) => setBaseUrl(d.value)}
          />
        </Field>
        <Field label="模型">
          <Input
            value={model}
            placeholder="gpt-4o-mini"
            onChange={(_, d) => setModel(d.value)}
          />
        </Field>
        <Field label="API 密钥">
          <Input
            type="password"
            value={apiKey}
            placeholder={initial?.api_key_set ? "已配置——留空则保持不变" : "sk-..."}
            onChange={(_, d) => setApiKey(d.value)}
          />
        </Field>
        <div className={s.actions}>
          <Button type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" appearance="primary" disabled={submitting || !name.trim()}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 推理工程
// ---------------------------------------------------------------------------

interface KV {
  key: string;
  value: string;
}

/** Editable list of key/value parameter rows (replaces the old JSON editor). */
function KeyValueEditor({
  pairs,
  onChange,
}: {
  pairs: KV[];
  onChange: (next: KV[]) => void;
}) {
  const s = useStyles();
  const update = (i: number, patch: Partial<KV>) =>
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  return (
    <div>
      {pairs.map((p, i) => (
        <div key={i} className={s.kvRow}>
          <Input
            className={s.kvInput}
            value={p.key}
            placeholder="参数名 (如 prompt)"
            onChange={(_, d) => update(i, { key: d.value })}
          />
          <Input
            className={s.kvInput}
            value={p.value}
            placeholder="默认值"
            onChange={(_, d) => update(i, { value: d.value })}
          />
          <Button
            appearance="subtle"
            icon={<Delete20Regular />}
            aria-label="删除参数"
            onClick={() => onChange(pairs.filter((_, idx) => idx !== i))}
          />
        </div>
      ))}
      <Button
        size="small"
        icon={<Add20Regular />}
        onClick={() => onChange([...pairs, { key: "", value: "" }])}
      >
        添加参数
      </Button>
    </div>
  );
}

function EnginesTab() {
  const shared = useSharedStyles();
  const s = useStyles();
  const { data, loading, error, reload } = useAsync(() => api.listInferenceEngines(), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InferenceEngine | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDelete = async (id: number) => {
    setActionError(null);
    try {
      await api.deleteInferenceEngine(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div className={shared.toolbar}>
        <Button appearance="primary" icon={<Add20Regular />} onClick={() => setCreating(true)}>
          新建推理工程
        </Button>
      </div>

      <p className={`${shared.muted} ${shared.small}`} style={{ marginTop: 0 }}>
        推理工程定义运行推理的命令、工作目录与参数；可在项目中设为默认，并在运行推理时选用。
      </p>

      <ErrorBanner error={error ?? actionError} />

      {loading ? (
        <Spinner label="加载中…" />
      ) : !data || data.length === 0 ? (
        <div className={shared.empty}>还没有推理工程，点击上方新建一个吧。</div>
      ) : (
        <div className={shared.col}>
          {data.map((engine) => {
            const paramCount = Object.keys(engine.params ?? {}).length;
            return (
              <Card key={engine.id}>
                <div className={s.cardHeader}>
                  <Body1Strong>{engine.name}</Body1Strong>
                  <Badge appearance="outline" color="informative">
                    {formatDate(engine.created_at)}
                  </Badge>
                </div>
                <div className={shared.kv}>
                  <span className={shared.kvKey}>命令</span>
                  <span className={shared.kvVal}>{engine.command || "—"}</span>
                  <span className={shared.kvKey}>工作目录</span>
                  <span className={shared.kvVal}>{engine.workdir || "—"}</span>
                  <span className={shared.kvKey}>参数</span>
                  <span className={shared.kvVal}>
                    {paramCount > 0 ? Object.keys(engine.params).join("、") : "无"}
                  </span>
                </div>
                <div className={shared.btnRow}>
                  <Button size="small" onClick={() => setEditing(engine)}>
                    编辑
                  </Button>
                  <ConfirmButton
                    message={`删除推理工程「${engine.name}」？（不影响已有推理）`}
                    onConfirm={() => handleDelete(engine.id)}
                  >
                    删除
                  </ConfirmButton>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creating && (
        <EngineModal
          title="新建推理工程"
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            await api.createInferenceEngine(input);
            await reload();
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <EngineModal
          title="编辑推理工程"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            await api.updateInferenceEngine(editing.id, input);
            await reload();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EngineModal(props: {
  title: string;
  initial?: InferenceEngine;
  onClose: () => void;
  onSubmit: (input: InferenceEngineInput) => Promise<void>;
}) {
  const { title, initial, onClose, onSubmit } = props;
  const shared = useSharedStyles();
  const s = useStyles();
  const [name, setName] = useState(initial?.name ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [workdir, setWorkdir] = useState(initial?.workdir ?? "");
  const [pairs, setPairs] = useState<KV[]>(() =>
    Object.entries(initial?.params ?? {}).map(([key, value]) => ({
      key,
      value: value == null ? "" : String(value),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) {
      setError("名称为必填项。");
      return;
    }
    const params: Record<string, string> = {};
    for (const p of pairs) {
      const k = p.key.trim();
      if (!k) continue;
      if (k in params) {
        setError(`参数名重复：${k}`);
        return;
      }
      params[k] = p.value;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), command, workdir: workdir.trim(), params });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} wide title={title}>
      <form onSubmit={handleSubmit}>
        <ErrorBanner error={error} />
        <Field label="名称" required>
          <Input
            value={name}
            autoFocus
            placeholder="Mock 推理"
            onChange={(_, d) => setName(d.value)}
          />
        </Field>
        <Field
          label="推理命令"
          hint="{checkpoint} 与 {output_dir} 会自动填充；下方参数默认以 --键 值 追加到命令末尾，也可用 {键} 在命令中就地引用（引用后不再追加）。"
        >
          <Textarea
            className={shared.mono}
            value={command}
            resize="vertical"
            rows={3}
            placeholder={'python infer.py --ckpt "{checkpoint}" --out "{output_dir}" --prompt "{prompt}"'}
            onChange={(_, d) => setCommand(d.value)}
          />
        </Field>
        <Field label="工作目录">
          <Input
            value={workdir}
            placeholder="命令的工作目录（可选）"
            className={shared.mono}
            onChange={(_, d) => setWorkdir(d.value)}
          />
        </Field>
        <Field
          label="参数（键值对）"
          hint="默认以 --键 值 追加到命令；命令中用 {键} 引用则改为就地替换。运行推理时可临时修改默认值。空值则追加为 --键 开关。"
        >
          <KeyValueEditor pairs={pairs} onChange={setPairs} />
        </Field>
        <div className={s.actions}>
          <Button type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" appearance="primary" disabled={submitting || !name.trim()}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
