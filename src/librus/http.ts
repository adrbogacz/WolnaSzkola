import { Platform } from 'react-native';

import { decodeBytesAsText } from '@/src/format';

import { KlasowaError } from './errors';
import { isLoginLogActive, logNet, sanitizeUrl } from './loginLog';
import { librusHttpsUrl } from './urls';

type Cookie = {
  name: string;
  value: string;
  domain: string;
};

export class CookieJar {
  private cookies: Cookie[] = [];
  /** After a 3xx we captured hop-by-hop, send the JS jar instead of native cookies. */
  explicitCookies = false;

  headerFor(url: string): string {
    const host = hostname(url);
    return this.cookies
      .filter((cookie) => hostMatches(host, cookie.domain))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  capture(url: string, response: Response) {
    const host = hostname(url);
    for (const line of readSetCookie(response)) {
      const parsed = parseSetCookie(line, host);
      if (!parsed) continue;
      this.cookies = this.cookies.filter(
        (cookie) => !(cookie.name === parsed.name && cookie.domain === parsed.domain),
      );
      this.cookies.push(parsed);
    }
  }

  names(): string[] {
    return this.cookies.map((cookie) => `${cookie.name}@${cookie.domain}`);
  }

  hasHost(host: string): boolean {
    return this.cookies.some((cookie) => hostMatches(host, cookie.domain));
  }

  copyHost(fromHost: string, toHost: string) {
    const extras = this.cookies
      .filter((cookie) => hostMatches(fromHost, cookie.domain) || cookie.domain === fromHost)
      .map((cookie) => ({ ...cookie, domain: toHost }));
    for (const parsed of extras) {
      this.cookies = this.cookies.filter(
        (cookie) => !(cookie.name === parsed.name && cookie.domain === parsed.domain),
      );
      this.cookies.push(parsed);
    }
  }

  set(name: string, value: string, domain: string) {
    this.cookies = this.cookies.filter((cookie) => !(cookie.name === name && cookie.domain === domain));
    this.cookies.push({ name, value, domain });
  }

  hasName(name: string): boolean {
    return this.cookies.some((cookie) => cookie.name === name);
  }

  clear() {
    this.cookies = [];
    this.explicitCookies = false;
  }
}

export { librusHttpsUrl } from './urls';

export async function sessionFetch(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  url = librusHttpsUrl(url);
  const headers = new Headers(init.headers);
  // Never set User-Agent on iOS/Android: it breaks the native cookie store,
  // so Librus accepts the form and then the next request looks logged-out.
  if (Platform.OS !== 'web') {
    headers.delete('User-Agent');
  }
  const cookie = jar.headerFor(url);
  const sendJsCookies = Boolean(cookie) && (Platform.OS === 'web' || jar.explicitCookies);
  if (sendJsCookies && !headers.has('Cookie')) {
    headers.set('Cookie', cookie);
  }

  const method = (init.method ?? 'GET').toUpperCase();
  const verbose = shouldTrace(url);
  if (verbose) {
    const auth = headers.get('Authorization');
    const authKind = auth?.startsWith('Bearer') ? 'Bearer' : auth?.startsWith('Basic') ? 'Basic' : 'none';
    logNet(
      `${method} ${sanitizeUrl(url)} auth=${authKind} jsCookieHeader=${sendJsCookies ? 'yes' : 'no'} redirect=${init.redirect ?? 'follow'}`,
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (verbose) {
      logNet(`  network-fail ${message}`);
    }
    if (/CLEARTEXT|cleartext/i.test(message) && /^http:/i.test(url)) {
      return sessionFetch(jar, librusHttpsUrl(url), init);
    }
    throw new KlasowaError(
      'Nie udało się połączyć z serwerem. Sprawdź internet i spróbuj ponownie.',
      undefined,
      error,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    jar.explicitCookies = true;
  }

  jar.capture(response.url || url, response);
  if (verbose) {
    const setCookieNames = readSetCookie(response)
      .map((line) => line.split('=')[0]?.trim())
      .filter(Boolean);
    logNet(
      `  -> ${response.status} final=${sanitizeUrl(response.url)} type=${response.headers.get('content-type') ?? 'none'} set-cookie=[${setCookieNames.join(',')}] jar=[${jar.names().join(',')}]`,
    );
  }
  return response;
}

export async function sessionFetchFollow(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
  maxHops = 10,
): Promise<Response> {
  let currentUrl = librusHttpsUrl(url);
  let method = (init.method ?? 'GET').toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers);

  for (let hop = 0; hop < maxHops; hop += 1) {
    const response = await sessionFetch(jar, currentUrl, {
      ...init,
      method,
      body: hop === 0 ? body : undefined,
      headers,
      redirect: 'manual',
    });

    if (response.type === 'opaqueredirect' || response.status === 0) {
      if (shouldTrace(currentUrl)) {
        logNet('  opaque-redirect — native follows hops itself');
      }
      return sessionFetch(jar, librusHttpsUrl(hop === 0 ? url : currentUrl), {
        ...init,
        method: hop === 0 ? (init.method ?? 'GET') : 'GET',
        body: hop === 0 ? init.body : undefined,
        redirect: 'follow',
      });
    }

    const location = response.headers.get('Location') ?? response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) {
      return response;
    }

    await readResponseText(response);
    const nextUrl = librusHttpsUrl(new URL(location, currentUrl).toString());
    if (shouldTrace(currentUrl) || shouldTrace(nextUrl)) {
      logNet(`  hop ${response.status} -> ${sanitizeUrl(nextUrl)}`);
    }
    currentUrl = nextUrl;
    method = 'GET';
    body = undefined;
    headers.delete('Content-Type');
  }

  throw new KlasowaError('Zbyt wiele przekierowań przy logowaniu.');
}

export async function readResponseText(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return decodeBytesAsText(bytes);
}

export async function readJson(response: Response, endpoint: string): Promise<unknown> {
  const text = await readResponseText(response);
  if (!text) return {};
  if (text.length > 2_000_000) {
    throw new KlasowaError('Odpowiedź serwera jest zbyt duża.', response.status, { endpoint });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (isLoginLogActive() || shouldTrace(endpoint)) {
      logNet(`  not-json ${endpoint} bytes=${text.length}`);
    }
    throw new KlasowaError(
      'Serwer zwrócił nieoczekiwaną odpowiedź. Spróbuj ponownie za chwilę.',
      response.status,
      { endpoint },
    );
  }
}

function shouldTrace(url: string): boolean {
  return isLoginLogActive() || (__DEV__ && /wiadomosci|refreshToken|\/inbox\/|\/Messages/i.test(url));
}

function hostname(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

function hostMatches(host: string, domain: string): boolean {
  const normalized = domain.replace(/^\./, '').toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}

function readSetCookie(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
    map?: Record<string, string | string[]>;
  };

  if (typeof headers.getSetCookie === 'function') {
    const list = headers.getSetCookie();
    if (list.length > 0) return list;
  }

  const mapped = headers.map?.['set-cookie'];
  if (mapped) {
    return Array.isArray(mapped) ? mapped : [mapped];
  }

  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function parseSetCookie(line: string, fallbackHost: string): Cookie | null {
  const parts = line.split(';');
  const [nameValue, ...attributes] = parts;
  if (!nameValue) return null;
  const separator = nameValue.indexOf('=');
  if (separator <= 0) return null;

  const name = nameValue.slice(0, separator).trim();
  const value = nameValue.slice(separator + 1).trim();
  if (!name) return null;

  let domain = fallbackHost;
  for (const attribute of attributes) {
    const [key, raw] = attribute.split('=');
    if (key?.trim().toLowerCase() === 'domain' && raw) {
      domain = raw.trim().replace(/^\./, '');
    }
  }

  return { name, value, domain };
}
