import { useCallback, useEffect, useRef, useState } from 'react';

import { errorKind, messageFromUnknown, StaleResultError, type ErrorKind } from '@/src/librus/errors';

export type SyncError = { message: string; kind: ErrorKind };

/**
 * Shows cached data first, then refreshes from the network.
 * - Only the newest request may update state, so a slow response for a previous child,
 *   account or message never overwrites what is on screen.
 * - When cached data is on screen and the refresh fails, the data stays and `syncError`
 *   is set (for a banner); `error` is only set when there is nothing to show.
 */
export function useSchoolQuery<T>(
  loader: (force?: boolean) => Promise<T>,
  deps: unknown[] = [],
  peek?: () => Promise<T | null | undefined>,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<SyncError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  /** A network request is in flight, even while cached data is shown. */
  const [fetching, setFetching] = useState(false);
  const loaderRef = useRef(loader);
  const peekRef = useRef(peek);
  const dataRef = useRef<T | null>(null);
  const ticketRef = useRef(0);
  loaderRef.current = loader;
  peekRef.current = peek;

  const reload = useCallback(async (force = false) => {
    const ticket = ++ticketRef.current;
    if (force) setRefreshing(true);
    else if (dataRef.current == null) setLoading(true);
    setFetching(true);
    setError(null);
    try {
      const next = await loaderRef.current(force);
      if (ticket !== ticketRef.current) return;
      dataRef.current = next;
      setData(next);
      setSyncError(null);
    } catch (caught) {
      if (ticket !== ticketRef.current || caught instanceof StaleResultError) return;
      const message = messageFromUnknown(caught);
      if (dataRef.current == null) setError(message);
      else setSyncError({ message, kind: errorKind(caught) });
    } finally {
      if (ticket === ticketRef.current) {
        setLoading(false);
        setRefreshing(false);
        setFetching(false);
      }
    }
    // deps describe when to create a new reload function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!enabled) return;
    // New child, account or message: never keep showing the previous one's data.
    const ticket = ++ticketRef.current;
    dataRef.current = null;
    setData(null);
    setSyncError(null);
    setLoading(true);
    void (async () => {
      if (peekRef.current) {
        try {
          const cached = await peekRef.current();
          if (ticket === ticketRef.current && cached != null) {
            dataRef.current = cached;
            setData(cached);
            setLoading(false);
          }
        } catch {
          // Network load below still runs.
        }
      }
      if (ticket === ticketRef.current) await reload(false);
    })();
    return () => {
      ticketRef.current += 1;
    };
  }, [enabled, reload]);

  return { data, error, syncError, loading, refreshing, fetching, reload };
}
