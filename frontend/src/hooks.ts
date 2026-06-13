import { useCallback, useEffect, useRef, useState } from "react";

/** Run an async loader, exposing data/loading/error and a manual reload(). */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  // Tracks whether we already have data, without re-triggering reload's
  // useCallback. Lets background reloads (polling, post-action refresh) update
  // in place instead of flashing the blocking loading state — which otherwise
  // makes lists disappear and reappear on every poll tick.
  const hasDataRef = useRef(false);

  const reload = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true);
    setError(null);
    try {
      const next = await loaderRef.current();
      hasDataRef.current = true;
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // New deps => a fresh load: show the spinner and drop now-stale data.
    hasDataRef.current = false;
    setData(null);
    setLoading(true);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload, setData };
}

/** Call `fn` every `intervalMs` while `active` is true. Cleans up on unmount. */
export function usePolling(fn: () => void, active: boolean, intervalMs = 2000) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => fnRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}
