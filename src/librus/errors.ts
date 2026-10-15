/** How a failure should be shown: offline/timeout/server keep cached data on screen with a banner. */
export type ErrorKind = 'offline' | 'timeout' | 'server' | 'auth' | 'malformed' | 'stale' | 'unknown';

export class KlasowaError extends Error {
  status?: number;
  causeDetail?: unknown;
  kind: ErrorKind;

  constructor(message: string, status?: number, causeDetail?: unknown, kind?: ErrorKind) {
    super(message);
    this.name = 'KlasowaError';
    this.status = status;
    this.causeDetail = causeDetail;
    this.kind = kind ?? kindFromStatus(status);
  }
}

/** A response that arrived after the user switched child or account; callers drop it silently. */
export class StaleResultError extends KlasowaError {
  constructor() {
    super('Wynik dotyczy poprzednio wybranego ucznia.', undefined, undefined, 'stale');
    this.name = 'StaleResultError';
  }
}

export function kindFromStatus(status?: number): ErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return 'server';
  return 'unknown';
}

export function errorKind(error: unknown): ErrorKind {
  return error instanceof KlasowaError ? error.kind : 'unknown';
}

/** Network is down or Librus is not answering: retrying other endpoints right away will not help. */
export function isConnectivityError(error: unknown): boolean {
  const kind = errorKind(error);
  return kind === 'offline' || kind === 'timeout';
}

export function messageFromUnknown(error: unknown): string {
  if (error instanceof KlasowaError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Coś poszło nie tak. Spróbuj ponownie.';
}
