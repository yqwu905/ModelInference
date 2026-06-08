import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Body1,
  Subtitle1,
  Tab,
  TabList,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ThemeToggle } from "./theme/ThemeModeContext";
import { useSharedStyles } from "./theme/sharedStyles";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ExperimentDetailPage from "./pages/ExperimentDetailPage";
import InferenceBrowsePage from "./pages/InferenceBrowsePage";
import SettingsPage from "./pages/SettingsPage";

type NavValue = "projects" | "inference" | "settings";

const useStyles = makeStyles({
  topbar: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXL,
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
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
    whiteSpace: "nowrap",
  },
  nav: { flexGrow: 1 },
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

/** Map the current pathname to the active top-level nav tab. */
function activeNav(pathname: string): NavValue {
  if (pathname.startsWith("/inference")) return "inference";
  if (pathname.startsWith("/settings")) return "settings";
  // Projects owns the root and the nested project/experiment routes.
  return "projects";
}

const NAV_ROUTE: Record<NavValue, string> = {
  projects: "/",
  inference: "/inference",
  settings: "/settings",
};

function TopNav() {
  const s = useStyles();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <header className={s.topbar}>
      <Link to="/" className={s.brand}>
        ModelInference
      </Link>
      <TabList
        className={s.nav}
        selectedValue={activeNav(pathname)}
        onTabSelect={(_, d) => navigate(NAV_ROUTE[d.value as NavValue])}
      >
        <Tab value="projects">项目</Tab>
        <Tab value="inference">推理结果</Tab>
        <Tab value="settings">设置</Tab>
      </TabList>
      <ThemeToggle />
    </header>
  );
}

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
      <TopNav />
      <main className={s.main}>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/experiments/:experimentId" element={<ExperimentDetailPage />} />
          <Route path="/inference" element={<InferenceBrowsePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}
