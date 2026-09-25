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
