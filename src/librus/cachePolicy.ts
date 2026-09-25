import type { SchoolMessage } from './types';

export const INBOX_TTL_MS = 10 * 60 * 1000;
export const RECEIVERS_TTL_MS = 24 * 60 * 60 * 1000;
export const MESSAGE_BODY_TTL_MS = Number.POSITIVE_INFINITY;

export type TtlEntry<T> = { savedAt: number; data: T };

export function isFresh(savedAt: number, ttlMs: number, now = Date.now()): boolean {
  if (!savedAt || savedAt <= 0) return false;
  if (!Number.isFinite(ttlMs)) return true;
  return now - savedAt < ttlMs;
}

export function readFresh<T>(entry: TtlEntry<T> | null | undefined, ttlMs: number, now = Date.now()): T | null {
  if (!entry) return null;
  return isFresh(entry.savedAt, ttlMs, now) ? entry.data : null;
}

export function messageHasBody(message?: SchoolMessage | null): boolean {
  return Boolean(message?.body?.trim());
}

export async function loadWithTtl<T>(options: {
  force?: boolean;
  memory: TtlEntry<T> | null;
  ttlMs: number;
  loadDisk: () => Promise<TtlEntry<T> | null>;
  fetchNetwork: () => Promise<T>;
  now?: number;
}): Promise<{ data: T; fromNetwork: boolean; entry: TtlEntry<T> }> {
  const now = options.now ?? Date.now();
  if (!options.force) {
    const memory = readFresh(options.memory, options.ttlMs, now);
    if (memory !== null && options.memory) {
      return { data: memory, fromNetwork: false, entry: options.memory };
    }
    const disk = await options.loadDisk();
    const freshDisk = readFresh(disk, options.ttlMs, now);
    if (freshDisk !== null && disk) {
      return { data: freshDisk, fromNetwork: false, entry: disk };
    }
  }
  const data = await options.fetchNetwork();
  return { data, fromNetwork: true, entry: { savedAt: now, data } };
}
