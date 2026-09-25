import { Platform } from 'react-native';

let active = false;
let lines: string[] = [];

export function beginLoginLog(): void {
  active = true;
  lines = [`WolnaSzkoła login ${new Date().toISOString()} os=${Platform.OS}`];
}

export function endLoginLog(): void {
  active = false;
}

export function isLoginLogActive(): boolean {
  return active;
}

export function logNet(line: string): void {
  if (active) lines.push(line);
  if (__DEV__) console.log(`[WolnaSzkoła] ${line}`);
}

export function logLogin(line: string): void {
  if (!active) return;
  lines.push(line);
  if (__DEV__) console.log(`[WolnaSzkoła] ${line}`);
}

export function getLoginLog(): string {
  return lines.join('\n');
}

export function maskLogin(login: string): string {
  if (!login) return '';
  if (login.length <= 3) return '*'.repeat(login.length);
  return `${'*'.repeat(login.length - 3)}${login.slice(-3)}`;
}

export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/code|token|pass|secret|sid|auth/i.test(key)) {
        parsed.searchParams.set(key, '…');
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function summarizeJson(value: unknown): string {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return '[unserializable]';
  }
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length > 48) return `${value.slice(0, 8)}…len=${value.length}`;
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 8).map(redact);
  if (!value || typeof value !== 'object') return value;

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/pass|token|secret|authorization|cookie|sid|^login$/i.test(key)) {
      output[key] = typeof nested === 'string' ? `…len=${nested.length}` : '[redacted]';
    } else {
      output[key] = redact(nested);
    }
  }
  return output;
}
