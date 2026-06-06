import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Body1,
  Body1Strong,
  Button,
  Card,
  Field,
  Input,
  Textarea,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular } from "@fluentui/react-icons";
import { api } from "../api";
import type { Project } from "../types";
import { useAsync } from "../hooks";
import { useSharedStyles } from "../theme/sharedStyles";
import { ConfirmButton, ErrorBanner, Modal, Spinner, formatDate } from "../components/ui";

const DELETE_MESSAGE =
  "删除该项目？这将永久删除其所有实验、检查点、推理结果与评测记录。";

const useStyles = makeStyles({
  card: { cursor: "pointer" },
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    rowGap: tokens.spacingVerticalXS,
  },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalL,
  },
});

function NewProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const s = useStyles();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const project = await api.createProject({
        name: name.trim(),
        description: description.trim(),
      });
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="新建项目">
      <form onSubmit={submit}>
        <ErrorBanner error={error} />
        <Field label="名称" required>
          <Input
            value={name}
            autoFocus
            required
            placeholder="我的项目"
            onChange={(_, data) => setName(data.value)}
          />
        </Field>
        <Field label="描述">
          <Textarea
            value={description}
            placeholder="这个项目是关于什么的？"
            resize="vertical"
            onChange={(_, data) => setDescription(data.value)}
          />
        </Field>
        <div className={s.actions}>
          <Button type="button" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" appearance="primary" disabled={saving || !name.trim()}>
            {saving ? "创建中…" : "创建项目"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const s = useStyles();
  const shared = useSharedStyles();
  return (
    <Card className={s.card} onClick={onOpen} focusMode="no-tab">
      <Body1Strong>{project.name}</Body1Strong>
      <Body1 className={shared.muted}>{project.description || "暂无描述"}</Body1>
      <div className={s.badgeRow}>
        <Badge appearance="outline" color="informative">
          {project.vlm_model || "未设置 VLM"}
        </Badge>
        <Badge appearance="outline" color="informative">
          {formatDate(project.created_at)}
        </Badge>
      </div>
      <div className={shared.btnRow} onClick={(e) => e.stopPropagation()}>
        <ConfirmButton message={DELETE_MESSAGE} onConfirm={onDelete}>
          删除
        </ConfirmButton>
      </div>
    </Card>
  );
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const shared = useSharedStyles();
  const { data, loading, error, reload } = useAsync(() => api.listProjects(), []);
  const [modalOpen, setModalOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDelete = async (id: number) => {
    setActionError(null);
    try {
      await api.deleteProject(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      await reload();
    }
  };

  return (
    <div className={shared.container}>
      <div className={`${shared.toolbar} ${shared.spread}`}>
        <Title3>项目</Title3>
        <Button appearance="primary" icon={<Add20Regular />} onClick={() => setModalOpen(true)}>
          新建项目
        </Button>
      </div>

      <ErrorBanner error={error ?? actionError} />

      {loading ? (
        <Spinner label="加载中…" />
      ) : !data || data.length === 0 ? (
        <div className={shared.empty}>还没有项目，点击右上角新建一个吧。</div>
      ) : (
        <div className={shared.grid}>
          {data.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => navigate(`/projects/${project.id}`)}
              onDelete={() => handleDelete(project.id)}
            />
          ))}
        </div>
      )}

      <NewProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(project) => navigate(`/projects/${project.id}`)}
      />
    </div>
  );
}
