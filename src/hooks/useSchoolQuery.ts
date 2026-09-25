import { useCallback, useEffect, useRef, useState } from 'react';

import { messageFromUnknown } from '@/src/librus/errors';

export function useSchoolQuery<T>(
  loader: (force?: boolean) => Promise<T>,
  deps: unknown[] = [],
  peek?: () => Promise<T | null | undefined>,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loaderRef = useRef(loader);
  const peekRef = useRef(peek);
  const dataRef = useRef<T | null>(null);
  loaderRef.current = loader;
  peekRef.current = peek;
  dataRef.current = data;

  const reload = useCallback(async (soft = false) => {
    const force = soft;
    if (force) setRefreshing(true);
    else if (dataRef.current == null) setLoading(true);
    setError(null);
    try {
      const next = await loaderRef.current(force);
      dataRef.current = next;
      setData(next);
    } catch (caught) {
      if (dataRef.current == null) setError(messageFromUnknown(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // deps describe when to create a new reload function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (peekRef.current) {
        try {
          const cached = await peekRef.current();
          if (!cancelled && cached != null) {
            dataRef.current = cached;
            setData(cached);
            setLoading(false);
          }
        } catch {
          // Network load below still runs.
        }
      }
      if (!cancelled) await reload(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return { data, error, loading, refreshing, reload };
}
