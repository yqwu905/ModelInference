import React, { useEffect } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";

// Re-export Fluent's Spinner under our stable name so existing callers keep
// importing `Spinner` from this module.
export { Spinner };

const useUiStyles = makeStyles({
  surface: { maxWidth: "560px" },
  surfaceWide: { maxWidth: "760px" },
  errorBar: { marginBottom: tokens.spacingVerticalL },
  danger: { color: tokens.colorPaletteRedForeground1 },
  lightbox: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000000,
    cursor: "zoom-out",
  },
  lightboxImg: {
    maxWidth: "92vw",
    maxHeight: "92vh",
    borderRadius: tokens.borderRadiusSmall,
  },
});

/** Modal dialog. Closes on overlay click / Esc. Pass a <form> as children so
 *  Enter-to-submit works; action buttons go at the end of the form. */
export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const { open, onClose, title, wide, children } = props;
  const styles = useUiStyles();
  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DialogSurface className={wide ? styles.surfaceWide : styles.surface}>
        <DialogBody>
          {title !== undefined && (
            <DialogTitle
              action={
                <Button
                  appearance="subtle"
                  aria-label="关闭"
                  icon={<Dismiss20Regular />}
                  onClick={onClose}
                />
              }
            >
              {title}
            </DialogTitle>
          )}
          <DialogContent>{children}</DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  copying: "拷贝中",
  running: "运行中",
  ready: "就绪",
  done: "完成",
  failed: "失败",
};
const STATUS_COLOR: Record<string, "success" | "warning" | "danger" | "subtle"> = {
  ready: "success",
  done: "success",
  pending: "warning",
  copying: "warning",
  running: "warning",
  failed: "danger",
};
const ACTIVE = new Set(["pending", "copying", "running"]);

/** Coloured status pill; shows a spinner for in-flight states. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      appearance="filled"
      color={STATUS_COLOR[status] ?? "subtle"}
      icon={ACTIVE.has(status) ? <Spinner size="extra-tiny" /> : undefined}
    >
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

/** Button that prompts window.confirm before invoking onConfirm. Danger-styled. */
export function ConfirmButton(props: {
  onConfirm: () => void;
  message?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { onConfirm, message = "确定吗？", children, disabled } = props;
  const styles = useUiStyles();
  return (
    <Button
      size="small"
      appearance="subtle"
      className={styles.danger}
      disabled={disabled}
      onClick={() => {
        if (window.confirm(message)) onConfirm();
      }}
    >
      {children}
    </Button>
  );
}

/** Full-screen image viewer. Click anywhere / Esc to dismiss. */
export function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  const styles = useUiStyles();
  useEffect(() => {
    if (!src) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [src, onClose]);
  if (!src) return null;
  return (
    <div className={styles.lightbox} onClick={onClose}>
      <img className={styles.lightboxImg} src={src} alt="" />
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  const styles = useUiStyles();
  if (!error) return null;
  return (
    <MessageBar className={styles.errorBar} intent="error">
      <MessageBarBody>{error}</MessageBarBody>
    </MessageBar>
  );
}

export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN");
}
