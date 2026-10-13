import { useCallback, useEffect, useRef, useState } from 'react';

// Page data kept for the browser session so revisiting a page shows its last
// data immediately while it is refreshed in the background. Cleared on sign-out.
const cache = new Map();

export function clearAsyncCache() {
  cache.clear();
}

/**
 * Runs an async loader whenever deps change. Returns { data, error, loading, reload }.
 * Stale responses from earlier calls are ignored. With a cacheKey, the last
 * result for the same key and deps is shown at once and then refreshed.
 */
export function useAsync(loader, deps = [], { enabled = true, cacheKey = null } = {}) {
  const key = cacheKey ? `${cacheKey}|${JSON.stringify(deps)}` : null;
  const [state, setState] = useState(() => ({ data: key ? cache.get(key) : undefined, error: null, loading: enabled }));
  const callId = useRef(0);
  const loaderRef = useRef(loader);
  const keyRef = useRef(key);
  useEffect(() => {
    loaderRef.current = loader;
    keyRef.current = key;
  });

  const run = useCallback(async () => {
    const id = ++callId.current;
    const k = keyRef.current;
    setState((s) => ({ data: k && cache.has(k) ? cache.get(k) : s.data, loading: true, error: null }));
    try {
      const data = await loaderRef.current();
      if (k) cache.set(k, data);
      if (id === callId.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === callId.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (enabled) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { ...state, reload: run };
}
