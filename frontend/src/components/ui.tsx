import React, { useEffect } from "react";

/** Modal dialog. Renders nothing when `open` is false. Closes on overlay click / Esc. */
export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const { open, onClose, title, wide, children } = props;
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal${wide ? " wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        {title !== undefined && (
          <div className="modal-title">
            <h2>{title}</h2>
            <button className="btn-sm" onClick={onClose}>✕</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  copying: "Copying",
  running: "Running",
  ready: "Ready",
  done: "Done",
  failed: "Failed",
};
const ACTIVE = new Set(["pending", "copying", "running"]);

/** Coloured status pill; shows a spinner for in-flight states. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      {ACTIVE.has(status) ? <Spinner /> : <span className="dot" />}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Spinner() {
  return (
    <svg className="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Button that prompts window.confirm before invoking onConfirm. */
export function ConfirmButton(props: {
  onConfirm: () => void;
  message?: string;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { onConfirm, message = "Are you sure?", className = "btn-sm btn-danger", children, disabled } = props;
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={() => {
        if (window.confirm(message)) onConfirm();
      }}
    >
      {children}
    </button>
  );
}

/** Full-screen image viewer. Click anywhere to dismiss. */
export function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!src) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [src, onClose]);
  if (!src) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={src} alt="" />
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="banner error">{error}</div>;
}

export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
