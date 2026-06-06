import { Link, Route, Routes } from "react-router-dom";
import { Body1, Subtitle1, makeStyles, tokens } from "@fluentui/react-components";
import { ThemeToggle } from "./theme/ThemeModeContext";
import { useSharedStyles } from "./theme/sharedStyles";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ExperimentDetailPage from "./pages/ExperimentDetailPage";
import ComparePage from "./pages/ComparePage";

const useStyles = makeStyles({
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalL,
    paddingTop: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
    paddingLeft: tokens.spacingHorizontalXL,
    paddingRight: tokens.spacingHorizontalXL,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  brand: {
    fontWeight: tokens.fontWeightBold,
    fontSize: tokens.fontSizeBase500,
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
  },
  main: { flexGrow: 1 },
  notFound: {
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
    paddingTop: tokens.spacingVerticalXXXL,
    paddingBottom: tokens.spacingVerticalXXXL,
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalM,
    alignItems: "center",
  },
});

function NotFound() {
  const s = useStyles();
  const shared = useSharedStyles();
  return (
    <div className={shared.container}>
      <div className={s.notFound}>
        <Subtitle1>页面未找到</Subtitle1>
        <Body1>您访问的页面不存在。</Body1>
        <Link to="/">返回首页</Link>
      </div>
    </div>
  );
}

export default function App() {
  const s = useStyles();
  return (
    <>
      <header className={s.topbar}>
        <Link to="/" className={s.brand}>
          ModelInference
        </Link>
        <ThemeToggle />
      </header>
      <main className={s.main}>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/experiments/:experimentId" element={<ExperimentDetailPage />} />
          <Route path="/experiments/:experimentId/compare" element={<ComparePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}
