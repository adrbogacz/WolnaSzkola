// Set only in e2e builds: every Librus host is served by the local mock (e2e/mock-librus.ts).
const MOCK_ROOT = process.env.EXPO_PUBLIC_LIBRUS_MOCK_URL?.replace(/\/+$/, '') ?? '';

/** `https://wiadomosci.librus.pl/api/x` → `<mock>/wiadomosci/api/x` when the e2e mock is configured. */
export function librusMockUrl(url: string): string {
  if (!MOCK_ROOT) return url;
  return url.replace(/^https:\/\/(api|synergia|wiadomosci)\.librus\.pl/i, `${MOCK_ROOT}/$1`);
}

export function librusHttpsUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const librus = host === 'librus.pl' || host.endsWith('.librus.pl');
    if (parsed.protocol === 'http:' && librus) {
      parsed.protocol = 'https:';
      return parsed.toString();
    }
  } catch {
    // Keep the original URL if it is not parseable.
  }
  return url;
}
