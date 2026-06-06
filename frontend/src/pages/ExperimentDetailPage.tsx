import { Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Body1,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Button,
  Card,
  Subtitle2,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowRight20Regular } from "@fluentui/react-icons";
import { api } from "../api";
import type { Project } from "../types";
import { useAsync } from "../hooks";
import { useSharedStyles } from "../theme/sharedStyles";
import { ErrorBanner, Spinner } from "../components/ui";
import CheckpointPanel from "../components/CheckpointPanel";
import InferencePanel from "../components/InferencePanel";

const useStyles = makeStyles({
  breadcrumb: { marginBottom: tokens.spacingVerticalL },
  card: { marginTop: tokens.spacingVerticalL },
});

export default function ExperimentDetailPage() {
  const { experimentId: experimentIdParam } = useParams();
  const experimentId = Number(experimentIdParam);
  const navigate = useNavigate();
  const shared = useSharedStyles();
  const s = useStyles();

  const {
    data: experiment,
    loading: experimentLoading,
    error: experimentError,
  } = useAsync(() => api.getExperiment(experimentId), [experimentId]);

  const {
    data: project,
    loading: projectLoading,
    error: projectError,
  } = useAsync<Project>(
    () =>
      experiment
        ? api.getProject(experiment.project_id)
        : Promise.reject(new Error("experiment not loaded")),
    [experiment?.project_id],
  );

  if (experimentLoading || (experiment && projectLoading)) {
    return (
      <div className={shared.container}>
        <Spinner label="加载中…" />
      </div>
    );
  }

  if (experimentError || !experiment) {
    return (
      <div className={shared.container}>
        <ErrorBanner error={experimentError ?? "未找到实验"} />
      </div>
    );
  }

  const hyperparams = Object.entries(experiment.hyperparameters);

  return (
    <div className={shared.container}>
      <Breadcrumb className={s.breadcrumb}>
        <BreadcrumbItem>
          <BreadcrumbButton onClick={() => navigate("/")}>项目</BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          {project ? (
            <BreadcrumbButton onClick={() => navigate(`/projects/${project.id}`)}>
              {project.name}
            </BreadcrumbButton>
          ) : (
            <BreadcrumbButton
              onClick={() => navigate(`/projects/${experiment.project_id}`)}
            >
              项目
            </BreadcrumbButton>
          )}
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>{experiment.name}</BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <div className={`${shared.toolbar} ${shared.spread}`}>
        <Title3>{experiment.name}</Title3>
        <Button
          icon={<ArrowRight20Regular />}
          iconPosition="after"
          onClick={() => navigate(`/experiments/${experimentId}/compare`)}
        >
          对比推理
        </Button>
      </div>

      {experiment.description && (
        <Body1 className={shared.muted}>{experiment.description}</Body1>
      )}

      <ErrorBanner error={projectError} />

      <Card className={s.card}>
        <Subtitle2>超参数</Subtitle2>
        {hyperparams.length === 0 ? (
          <Body1 className={shared.muted}>暂无超参数记录。</Body1>
        ) : (
          <div className={shared.kv}>
            {hyperparams.map(([k, v]) => (
              <Fragment key={k}>
                <span className={shared.kvKey}>{k}</span>
                <span className={shared.kvVal}>
                  {typeof v === "string" ? v : JSON.stringify(v)}
                </span>
              </Fragment>
            ))}
          </div>
        )}
      </Card>

      <CheckpointPanel experimentId={experimentId} />

      {project && <InferencePanel experimentId={experimentId} project={project} />}
    </div>
  );
}
