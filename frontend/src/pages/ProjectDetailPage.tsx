import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Body1,
  Body1Strong,
  Button,
  Card,
  Field,
  Input,
  Subtitle2,
  Tab,
  TabList,
  Textarea,
  Title3,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Caption1,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular } from "@fluentui/react-icons";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { Experiment, ExperimentInput, ParamDef, Project, ProjectInput } from "../types";
import {
  ConfirmButton,
  ErrorBanner,
  formatDate,
  Modal,
  Spinner,
} from "../components/ui";
import { useSharedStyles } from "../theme/sharedStyles";

type TabValue = "experiments" | "settings";

const useStyles = makeStyles({
  card: { cursor: "pointer" },
  tabs: { marginBottom: tokens.spacingVerticalL },
  cardTitleRow: { marginBottom: tokens.spacingVerticalS },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalL,
  },
});

export default function ProjectDetailPage() {
  const { projectId: projectIdParam } = useParams();
  const projectId = Number(projectIdParam);
  const navigate = useNavigate();
  const shared = useSharedStyles();
  const s = useStyles();

  const project = useAsync<Project>(() => api.getProject(projectId), [projectId]);
  const experiments = useAsync<Experiment[]>(() => api.listExperiments(projectId), [projectId]);

  const [tab, setTab] = useState<TabValue>("experiments");

  if (project.loading && !project.data) {
    return (
      <div className={shared.container}>
        <Spinner label="加载中…" />
      </div>
    );
  }
  if (project.error || !project.data) {
    return (
      <div className={shared.container}>
        <ErrorBanner error={project.error ?? "未找到项目"} />
        <Button appearance="transparent" onClick={() => navigate("/")}>
          返回项目列表
        </Button>
      </div>
    );
  }

  const proj = project.data;

  return (
    <div className={shared.container}>
      <Breadcrumb>
        <BreadcrumbItem>
          <BreadcrumbButton onClick={() => navigate("/")}>项目</BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>{proj.name}</BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <Title3>{proj.name}</Title3>

      <TabList
        className={s.tabs}
        selectedValue={tab}
        onTabSelect={(_, d) => setTab(d.value as TabValue)}
      >
        <Tab value="experiments">实验</Tab>
        <Tab value="settings">设置</Tab>
      </TabList>

      {tab === "experiments" ? (
        <ExperimentsTab
          projectId={projectId}
          experiments={experiments.data ?? []}
          loading={experiments.loading}
          error={experiments.error}
          reload={experiments.reload}
          onOpen={(id) => navigate(`/experiments/${id}`)}
        />
      ) : (
        <SettingsTab project={proj} onSaved={project.reload} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 实验标签页
// ---------------------------------------------------------------------------

function ExperimentsTab(props: {
  projectId: number;
  experiments: Experiment[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void> | void;
  onOpen: (id: number) => void;
}) {
  const { projectId, experiments, loading, error, reload, onOpen } = props;
  const shared = useSharedStyles();
  const s = useStyles();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Experiment | null>(null);

  return (
    <div>
      <div className={shared.toolbar}>
        <Button
          appearance="primary"
          icon={<Add20Regular />}
          onClick={() => setCreating(true)}
        >
          新建实验
        </Button>
      </div>

      <ErrorBanner error={error} />

      {loading && experiments.length === 0 ? (
        <Spinner label="加载中…" />
      ) : experiments.length === 0 ? (
        <div className={shared.empty}>还没有实验，创建一个实验来组织检查点与推理吧。</div>
      ) : (
        <div className={shared.grid}>
          {experiments.map((e) => {
            const paramCount = Object.keys(e.hyperparameters ?? {}).length;
            return (
              <Card
                key={e.id}
                className={s.card}
                onClick={() => onOpen(e.id)}
                focusMode="no-tab"
              >
                <Body1Strong>{e.name}</Body1Strong>
                {e.description && <Body1 className={shared.muted}>{e.description}</Body1>}
                <Caption1 className={shared.muted}>
                  {paramCount} 个超参数 · {formatDate(e.created_at)}
                </Caption1>
                <div className={shared.btnRow} onClick={(ev) => ev.stopPropagation()}>
                  <Button
                    size="small"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEditing(e);
                    }}
                  >
                    编辑
                  </Button>
                  <ConfirmButton
                    message={`删除实验「${e.name}」？这将一并删除其检查点与推理结果。`}
                    onConfirm={async () => {
                      await api.deleteExperiment(e.id);
                      await reload();
                    }}
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
        <ExperimentModal
          title="新建实验"
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            await api.createExperiment(projectId, input);
            await reload();
            setCreating(false);
          }}
        />
      )}

      {editing && (
        <ExperimentModal
          title="编辑实验"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            await api.updateExperiment(editing.id, input);
            await reload();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ExperimentModal(props: {
  title: string;
  initial?: Experiment;
  onClose: () => void;
  onSubmit: (input: ExperimentInput) => Promise<void>;
}) {
  const { title, initial, onClose, onSubmit } = props;
  const shared = useSharedStyles();
  const s = useStyles();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [hyperText, setHyperText] = useState(
    initial ? JSON.stringify(initial.hyperparameters ?? {}, null, 2) : "{}"
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) {
      setError("名称为必填项。");
      return;
    }
    let hyperparameters: Record<string, unknown>;
    try {
      const parsed = JSON.parse(hyperText || "{}");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("超参数必须是一个 JSON 对象。");
        return;
      }
      hyperparameters = parsed as Record<string, unknown>;
    } catch (e) {
      setError(`JSON 无效：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), description, hyperparameters });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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
            placeholder="实验名称"
            onChange={(_, data) => setName(data.value)}
          />
        </Field>
        <Field label="描述">
          <Textarea
            value={description}
            placeholder="可选描述"
            resize="vertical"
            onChange={(_, data) => setDescription(data.value)}
          />
        </Field>
        <Field label="超参数 (JSON)">
          <Textarea
            className={shared.mono}
            value={hyperText}
            resize="vertical"
            rows={8}
            onChange={(_, data) => setHyperText(data.value)}
          />
        </Field>
        <div className={s.actions}>
          <Button type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" appearance="primary" disabled={submitting}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 设置标签页
// ---------------------------------------------------------------------------

function SettingsTab(props: { project: Project; onSaved: () => Promise<void> | void }) {
  const { project, onSaved } = props;
  const shared = useSharedStyles();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [inferenceCommand, setInferenceCommand] = useState(project.inference_command);
  const [inferenceWorkdir, setInferenceWorkdir] = useState(project.inference_workdir);
  const [schemaText, setSchemaText] = useState(
    JSON.stringify(project.inference_param_schema ?? [], null, 2)
  );
  const [vlmBaseUrl, setVlmBaseUrl] = useState(project.vlm_base_url);
  const [vlmModel, setVlmModel] = useState(project.vlm_model);
  const [vlmApiKey, setVlmApiKey] = useState("");
  const [evalPrompt, setEvalPrompt] = useState(project.eval_prompt);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 当项目（重新）加载时同步表单状态。
  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setInferenceCommand(project.inference_command);
    setInferenceWorkdir(project.inference_workdir);
    setSchemaText(JSON.stringify(project.inference_param_schema ?? [], null, 2));
    setVlmBaseUrl(project.vlm_base_url);
    setVlmModel(project.vlm_model);
    setVlmApiKey("");
    setEvalPrompt(project.eval_prompt);
  }, [project]);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(id);
  }, [saved]);

  const handleSave = async () => {
    let schema: ParamDef[];
    try {
      const parsed = JSON.parse(schemaText || "[]");
      if (!Array.isArray(parsed)) {
        setError("推理参数定义必须是一个 JSON 数组。");
        return;
      }
      schema = parsed as ParamDef[];
    } catch (e) {
      setError(`推理参数定义 JSON 无效：${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const payload: ProjectInput = {
      name,
      description,
      inference_command: inferenceCommand,
      inference_workdir: inferenceWorkdir,
      inference_param_schema: schema,
      vlm_base_url: vlmBaseUrl,
      vlm_model: vlmModel,
      eval_prompt: evalPrompt,
    };
    if (vlmApiKey.trim()) {
      payload.vlm_api_key = vlmApiKey;
    }

    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await api.updateProject(project.id, payload);
      await onSaved();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={shared.col}>
      <ErrorBanner error={error} />

      <Card>
        <Subtitle2>常规</Subtitle2>
        <Field label="名称">
          <Input value={name} onChange={(_, data) => setName(data.value)} />
        </Field>
        <Field label="描述">
          <Textarea
            value={description}
            resize="vertical"
            onChange={(_, data) => setDescription(data.value)}
          />
        </Field>
      </Card>

      <Card>
        <Subtitle2>推理引擎</Subtitle2>
        <Field
          label="推理命令"
          hint="令牌 {checkpoint} 与 {output_dir} 会自动填充；其他 {tokens} 来自推理参数。"
        >
          <Textarea
            className={shared.mono}
            value={inferenceCommand}
            resize="vertical"
            rows={3}
            onChange={(_, data) => setInferenceCommand(data.value)}
          />
        </Field>
        <Field label="推理工作目录">
          <Input
            value={inferenceWorkdir}
            placeholder="命令的工作目录（可选）"
            onChange={(_, data) => setInferenceWorkdir(data.value)}
          />
        </Field>
        <Field
          label="推理参数定义 (JSON)"
          hint="由 { name, label, type, default?, options? } 参数定义组成的数组。"
        >
          <Textarea
            className={shared.mono}
            value={schemaText}
            resize="vertical"
            rows={8}
            onChange={(_, data) => setSchemaText(data.value)}
          />
        </Field>
      </Card>

      <Card>
        <Subtitle2>VLM 评测</Subtitle2>
        <div className={mergeClasses(shared.row, shared.wrap)}>
          <Field className={shared.grow} label="VLM 接口地址">
            <Input
              value={vlmBaseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(_, data) => setVlmBaseUrl(data.value)}
            />
          </Field>
          <Field className={shared.grow} label="VLM 模型">
            <Input
              value={vlmModel}
              placeholder="gpt-4o-mini"
              onChange={(_, data) => setVlmModel(data.value)}
            />
          </Field>
        </div>
        <Field label="VLM API 密钥">
          <Input
            type="password"
            value={vlmApiKey}
            placeholder={project.vlm_api_key_set ? "已配置——留空则保持不变" : "sk-..."}
            onChange={(_, data) => setVlmApiKey(data.value)}
          />
        </Field>
        <Field label="评测提示词">
          <Textarea
            value={evalPrompt}
            resize="vertical"
            rows={5}
            onChange={(_, data) => setEvalPrompt(data.value)}
          />
        </Field>
      </Card>

      <div className={shared.toolbar}>
        <Button appearance="primary" onClick={handleSave} disabled={saving}>
          {saving ? "保存中…" : "保存设置"}
        </Button>
        {saved && (
          <Badge appearance="filled" color="success">
            已保存
          </Badge>
        )}
      </div>
    </div>
  );
}
