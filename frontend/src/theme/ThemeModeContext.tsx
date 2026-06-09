import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Button,
  FluentProvider,
  Tooltip,
  makeStyles,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import { WeatherMoon20Regular, WeatherSunny20Regular } from "@fluentui/react-icons";

type Mode = "dark" | "light";

const STORAGE_KEY = "modelinference.themeMode";

const ThemeModeContext = createContext<{ mode: Mode; toggle: () => void }>({
  mode: "dark",
  toggle: () => {},
});

/** Access the current theme mode and a toggle from anywhere in the tree. */
export function useThemeMode() {
  return useContext(ThemeModeContext);
}

function readInitialMode(): Mode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage unavailable (private mode etc.) — fall back to default */
  }
  return "dark";
}

const useStyles = makeStyles({
  // FluentProvider paints colorNeutralBackground1 but is only as tall as its
  // content; stretch it to fill the viewport so the themed background covers
  // the whole page.
  root: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
});

/** Root provider: owns theme-mode state, persists it, and themes the whole app. */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const [mode, setMode] = useState<Mode>(readInitialMode);

  const toggle = useCallback(() => {
    setMode((m) => {
      const next: Mode = m === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore persistence failure */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ mode, toggle }), [mode, toggle]);
  const theme = mode === "dark" ? webDarkTheme : webLightTheme;

  return (
    <ThemeModeContext.Provider value={value}>
      <FluentProvider theme={theme} className={styles.root}>
        {children}
      </FluentProvider>
    </ThemeModeContext.Provider>
  );
}

/** Top-bar button that flips between dark and light themes. */
export function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  const toLight = mode === "dark";
  return (
    <Tooltip content={toLight ? "切换到浅色主题" : "切换到深色主题"} relationship="label">
      <Button
        appearance="subtle"
        aria-label={toLight ? "切换到浅色主题" : "切换到深色主题"}
        icon={toLight ? <WeatherSunny20Regular /> : <WeatherMoon20Regular />}
        onClick={toggle}
      />
    </Tooltip>
  );
}
