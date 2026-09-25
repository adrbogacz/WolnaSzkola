import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { DEFAULT_APP_SETTINGS, type AppSettings, type HideStatus } from '@/src/appSettings';

const EMAIL = 'wolnaszkola.email';
const PASSWORD = 'wolnaszkola.password';
const CHILD_ID = 'wolnaszkola.childId';
const CHILD_LOGIN = 'wolnaszkola.childLogin';
const ACCOUNTS = 'wolnaszkola.accounts';
const ACTIVE_ACCOUNT = 'wolnaszkola.activeAccount';
const READ_STATE = 'wolnaszkola.readState';
const HIDE_STATE = 'wolnaszkola.hideState';
const SETTINGS = 'wolnaszkola.settings';
const SEEN_MESSAGES = 'wolnaszkola.seenMessages';
const READ_CHUNK = 1800;
const webSecrets = new Map<string, string>();

function isCredentialKey(key: string): boolean {
  return (
    key === EMAIL ||
    key === PASSWORD ||
    key === ACTIVE_ACCOUNT ||
    key === ACCOUNTS ||
    key.startsWith(`${ACCOUNTS}.`)
  );
}

async function read(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function write(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

async function readSecret(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return webSecrets.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function writeSecret(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (value === null) webSecrets.delete(key);
    else webSecrets.set(key, value);
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

function purgeWebCredentials(): void {
  const storage = globalThis.localStorage;
  if (!storage) return;
  for (const key of Object.keys(storage)) {
    if (isCredentialKey(key)) storage.removeItem(key);
  }
}

export type StoredAccount = {
  id: string;
  login: string;
  password: string;
  label: string;
  childId?: string;
  childLogin?: string;
};

export type StoredSession = {
  accountId: string;
  email: string;
  password: string;
  label: string;
  childId?: string;
  childLogin?: string;
};

export async function loadAccounts(): Promise<{ activeId: string | null; accounts: StoredAccount[] }> {
  if (Platform.OS === 'web') await adoptLegacyWebCredentials();
  const parsed = parseAccounts(await readSecretChunked(ACCOUNTS));
  if (parsed.length > 0) {
    const activeId = (await readSecret(ACTIVE_ACCOUNT)) ?? parsed[0]?.id ?? null;
    const active = parsed.find((account) => account.id === activeId) ? activeId : parsed[0]?.id ?? null;
    return { activeId: active, accounts: parsed };
  }

  const email = await readSecret(EMAIL);
  const password = await readSecret(PASSWORD);
  if (!email || !password) return { activeId: null, accounts: [] };
  const migrated: StoredAccount = {
    id: email,
    login: email,
    password,
    label: email,
    childId: (await read(CHILD_ID)) ?? undefined,
    childLogin: (await read(CHILD_LOGIN)) ?? undefined,
  };
  await saveAccounts([migrated], migrated.id);
  await writeSecret(EMAIL, null);
  await writeSecret(PASSWORD, null);
  await write(CHILD_ID, null);
  await write(CHILD_LOGIN, null);
  return { activeId: migrated.id, accounts: [migrated] };
}

export async function saveAccounts(accounts: StoredAccount[], activeId: string | null): Promise<void> {
  await writeSecretChunked(ACCOUNTS, JSON.stringify(accounts));
  await writeSecret(ACTIVE_ACCOUNT, activeId);
}

export async function loadSession(): Promise<StoredSession | null> {
  const { activeId, accounts } = await loadAccounts();
  const account = accounts.find((item) => item.id === activeId) ?? accounts[0];
  if (!account) return null;
  return {
    accountId: account.id,
    email: account.login,
    password: account.password,
    label: account.label,
    childId: account.childId,
    childLogin: account.childLogin,
  };
}

export async function saveCredentials(email: string, password: string, label?: string): Promise<string> {
  const login = email.trim();
  const { accounts } = await loadAccounts();
  const existing = accounts.find((account) => account.id === login || account.login === login);
  const next: StoredAccount = {
    id: login,
    login,
    password,
    label: label?.trim() || existing?.label || login,
    childId: existing?.childId,
    childLogin: existing?.childLogin,
  };
  const rest = accounts.filter((account) => account.id !== next.id && account.login !== login);
  await saveAccounts([next, ...rest], next.id);
  return next.id;
}

export async function saveChild(childId: string, childLogin: string): Promise<void> {
  const { activeId, accounts } = await loadAccounts();
  const account = accounts.find((item) => item.id === activeId);
  if (!account) return;
  account.childId = childId;
  account.childLogin = childLogin;
  await saveAccounts(accounts, activeId);
}

export async function saveAccountLabel(accountId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  const { activeId, accounts } = await loadAccounts();
  const account = accounts.find((item) => item.id === accountId);
  if (!account || account.label === trimmed) return;
  account.label = trimmed;
  await saveAccounts(accounts, activeId);
}

export async function clearSession(): Promise<void> {
  await writeSecretChunked(ACCOUNTS, JSON.stringify([]));
  await writeSecret(ACTIVE_ACCOUNT, null);
  await writeSecret(EMAIL, null);
  await writeSecret(PASSWORD, null);
  if (Platform.OS === 'web') purgeWebCredentials();
  await write(CHILD_ID, null);
  await write(CHILD_LOGIN, null);
  await write(SEEN_MESSAGES, null);
  await clearSchoolCache();
}

export async function loadReadState(accountId = ''): Promise<Record<string, boolean>> {
  const raw = await readChunked(scopedKey(READ_STATE, accountId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

export async function saveReadState(state: Record<string, boolean>, accountId = ''): Promise<void> {
  await writeChunked(scopedKey(READ_STATE, accountId), JSON.stringify(state));
}

export async function loadHideState(accountId = ''): Promise<Record<string, HideStatus>> {
  const raw = await readChunked(scopedKey(HIDE_STATE, accountId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const output: Record<string, HideStatus> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === 'archived' || value === 'deleted') output[id] = value;
    }
    return output;
  } catch {
    return {};
  }
}

export async function saveHideState(state: Record<string, HideStatus>, accountId = ''): Promise<void> {
  await writeChunked(scopedKey(HIDE_STATE, accountId), JSON.stringify(state));
}

export async function loadAppSettings(): Promise<AppSettings> {
  const raw = await read(SETTINGS);
  if (!raw) return { ...DEFAULT_APP_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const minutes = Number(parsed.syncIntervalMinutes);
    return {
      showArchived: Boolean(parsed.showArchived),
      syncIntervalMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : 0,
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  await write(SETTINGS, JSON.stringify(settings));
}

export async function loadSeenMessageIds(accountId = ''): Promise<string[]> {
  const raw = await read(scopedKey(SEEN_MESSAGES, accountId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

export async function saveSeenMessageIds(ids: string[], accountId = ''): Promise<void> {
  await write(scopedKey(SEEN_MESSAGES, accountId), JSON.stringify(ids.slice(-200)));
}

export async function clearLocalOverlays(accountId = ''): Promise<void> {
  await saveReadState({}, accountId);
  await saveHideState({}, accountId);
}

function scopedKey(prefix: string, accountId: string): string {
  const suffix = accountId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return suffix ? `${prefix}.${suffix}` : prefix;
}

function parseAccounts(raw: string): StoredAccount[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const account = item as Partial<StoredAccount>;
      const login = typeof account.login === 'string' ? account.login.trim() : '';
      const password = typeof account.password === 'string' ? account.password : '';
      if (!login || !password) return [];
      return [
        {
          id: typeof account.id === 'string' && account.id ? account.id : login,
          login,
          password,
          label: typeof account.label === 'string' && account.label.trim() ? account.label.trim() : login,
          childId: typeof account.childId === 'string' ? account.childId : undefined,
          childLogin: typeof account.childLogin === 'string' ? account.childLogin : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

async function readChunked(prefix: string): Promise<string> {
  const count = Number((await read(`${prefix}.n`)) ?? '0');
  if (count > 0) {
    let raw = '';
    for (let index = 0; index < count; index += 1) {
      raw += (await read(`${prefix}.${index}`)) ?? '';
    }
    return raw;
  }
  return (await read(prefix)) ?? '';
}

async function readSecretChunked(prefix: string): Promise<string> {
  const count = Number((await readSecret(`${prefix}.n`)) ?? '0');
  if (count > 0) {
    let raw = '';
    for (let index = 0; index < count; index += 1) {
      raw += (await readSecret(`${prefix}.${index}`)) ?? '';
    }
    return raw;
  }
  return (await readSecret(prefix)) ?? '';
}

async function writeChunked(prefix: string, raw: string): Promise<void> {
  const chunks = Math.max(1, Math.ceil(raw.length / READ_CHUNK));
  await write(`${prefix}.n`, String(chunks));
  for (let index = 0; index < chunks; index += 1) {
    await write(`${prefix}.${index}`, raw.slice(index * READ_CHUNK, (index + 1) * READ_CHUNK));
  }
}

async function writeSecretChunked(prefix: string, raw: string): Promise<void> {
  const chunks = Math.max(1, Math.ceil(raw.length / READ_CHUNK));
  await writeSecret(`${prefix}.n`, String(chunks));
  for (let index = 0; index < chunks; index += 1) {
    await writeSecret(`${prefix}.${index}`, raw.slice(index * READ_CHUNK, (index + 1) * READ_CHUNK));
  }
}

async function adoptLegacyWebCredentials(): Promise<void> {
  const storage = globalThis.localStorage;
  if (!storage) return;
  if ((await readSecretChunked(ACCOUNTS)) === '') {
    const count = Number(storage.getItem(`${ACCOUNTS}.n`) ?? '0');
    let raw = '';
    if (count > 0) {
      for (let index = 0; index < count; index += 1) raw += storage.getItem(`${ACCOUNTS}.${index}`) ?? '';
    } else {
      raw = storage.getItem(ACCOUNTS) ?? '';
    }
    if (raw) await writeSecretChunked(ACCOUNTS, raw);
  }
  if (!(await readSecret(EMAIL)) && storage.getItem(EMAIL)) {
    await writeSecret(EMAIL, storage.getItem(EMAIL));
  }
  if (!(await readSecret(PASSWORD)) && storage.getItem(PASSWORD)) {
    await writeSecret(PASSWORD, storage.getItem(PASSWORD));
  }
  if (!(await readSecret(ACTIVE_ACCOUNT)) && storage.getItem(ACTIVE_ACCOUNT)) {
    await writeSecret(ACTIVE_ACCOUNT, storage.getItem(ACTIVE_ACCOUNT));
  }
  purgeWebCredentials();
}

export type SchoolCacheEntry<T> = { savedAt: number; data: T };

function schoolCacheKey(scope: string, key: string): string {
  return `wolnaszkola.cache.${sanitizeCachePart(scope)}.${sanitizeCachePart(key)}`;
}

function sanitizeCachePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'x';
}

export async function loadSchoolCache<T>(scope: string, key: string): Promise<SchoolCacheEntry<T> | null> {
  const raw = await readSchoolFile(scope, key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SchoolCacheEntry<T>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.savedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSchoolCache<T>(scope: string, key: string, data: T, savedAt = Date.now()): Promise<void> {
  const payload = JSON.stringify({ savedAt, data } satisfies SchoolCacheEntry<T>);
  await writeSchoolFile(scope, key, payload);
}

export async function clearSchoolCache(): Promise<void> {
  if (Platform.OS === 'web') {
    const storage = globalThis.localStorage;
    if (!storage) return;
    for (const name of Object.keys(storage)) {
      if (name.startsWith('wolnaszkola.cache.')) storage.removeItem(name);
    }
    return;
  }
  try {
    const { Directory, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.document, 'wolnaszkola-cache');
    if (dir.exists) dir.delete();
  } catch {
    // Ignore missing files.
  }
}

async function readSchoolFile(scope: string, key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(schoolCacheKey(scope, key)) ?? null;
  }
  try {
    const { Directory, File, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.document, 'wolnaszkola-cache', sanitizeCachePart(scope));
    const file = new File(dir, `${sanitizeCachePart(key)}.json`);
    if (!file.exists) return null;
    return file.textSync();
  } catch {
    return null;
  }
}

async function writeSchoolFile(scope: string, key: string, raw: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(schoolCacheKey(scope, key), raw);
    return;
  }
  try {
    const { Directory, File, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.document, 'wolnaszkola-cache', sanitizeCachePart(scope));
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `${sanitizeCachePart(key)}.json`);
    if (!file.exists) file.create();
    file.write(raw);
  } catch {
    // Cache is optional; the next network fetch still works.
  }
}
