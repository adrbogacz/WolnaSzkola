const DAY_NAMES = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const DAY_SHORT = ['nd.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];

export function mondayOf(date = new Date()): Date {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  const day = copy.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + offset);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function weekdaysOf(weekStart: string): string[] {
  const monday = parseDate(weekStart) ?? new Date(`${weekStart}T12:00:00`);
  return [0, 1, 2, 3, 4].map((offset) => isoDate(addDays(monday, offset)));
}

export function eachIsoDate(from: string, to = from): string[] {
  const start = parseDate(from.slice(0, 10));
  const end = parseDate((to || from).slice(0, 10)) ?? start;
  if (!start || !end) return from ? [from.slice(0, 10)] : [];
  const dates: string[] = [];
  for (let current = new Date(start); current.getTime() <= end.getTime(); current = addDays(current, 1)) {
    dates.push(isoDate(current));
  }
  return dates;
}

export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDate(value: string): Date | null {
  if (!value) return null;
  const normalized = value.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime()) && !/^\d{1,2}\.\d{1,2}\.\d{4}/.test(value)) return parsed;
  const dotted = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (dotted) {
    return new Date(
      Number(dotted[3]),
      Number(dotted[2]) - 1,
      Number(dotted[1]),
      Number(dotted[4] ?? 12),
      Number(dotted[5] ?? 0),
    );
  }
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function sortNewest<T extends { sentAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const a = parseDate(left.sentAt)?.getTime() ?? 0;
    const b = parseDate(right.sentAt)?.getTime() ?? 0;
    return b - a;
  });
}

export function formatDayHeading(iso: string): string {
  const date = parseDate(iso);
  if (!date) return iso;
  const name = DAY_NAMES[date.getDay()];
  return `${capitalize(name)} ${date.getDate()}.${date.getMonth() + 1}`;
}

export function formatShortDay(iso: string): string {
  const date = parseDate(iso);
  if (!date) return iso;
  return `${DAY_SHORT[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}`;
}

export function formatDateTime(value: string): string {
  const date = parseDate(value);
  if (!date) return value;
  const day = `${date.getDate()}`.padStart(2, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()} ${hours}:${minutes}`;
}

export function formatDate(value: string): string {
  const date = parseDate(value);
  if (!date) return value;
  const day = `${date.getDate()}`.padStart(2, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  oacute: 'ó',
  Oacute: 'Ó',
  aacute: 'á',
  Aacute: 'Á',
  eacute: 'é',
  Eacute: 'É',
  iacute: 'í',
  Iacute: 'Í',
  uacute: 'ú',
  Uacute: 'Ú',
  yacute: 'ý',
  Yacute: 'Ý',
  nacute: 'ń',
  Nacute: 'Ń',
  sacute: 'ś',
  Sacute: 'Ś',
  cacute: 'ć',
  Cacute: 'Ć',
  zacute: 'ź',
  Zacute: 'Ź',
  lstrok: 'ł',
  Lstrok: 'Ł',
  eogonek: 'ę',
  Eogonek: 'Ę',
  aogonek: 'ą',
  Aogonek: 'Ą',
  zdot: 'ż',
  Zdot: 'Ż',
};

function fromCharCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

function countPolishLetters(value: string): number {
  return (value.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) ?? []).length;
}

function scoreDecodedText(value: string): number {
  const polish = countPolishLetters(value);
  const mojibake = (value.match(/[ÄÅÃÂ]/g) ?? []).length;
  const replacement = (value.match(/\uFFFD/g) ?? []).length;
  const controls = (value.match(/[\u0080-\u009F]/g) ?? []).length;
  return polish * 8 - mojibake * 6 - replacement * 5 - controls * 3;
}

function latin1BytesFromString(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0xfffd) continue;
    bytes.push(code <= 255 ? code : (CP1252_EXTRA[code] ?? 0x3f));
  }
  return Uint8Array.from(bytes);
}

function guessIncompleteLead(lead: number, next: number | undefined, prev: string): string {
  const nextCh = next !== undefined && next < 0x80 ? String.fromCharCode(next) : '';
  if (lead === 0xc3) return 'ó';
  if (lead === 0xc4) return /[tTjJwWmMbB]/.test(nextCh) ? 'ą' : 'ę';
  if (lead === 0xc5) {
    if (/[nNcClLsStT]/.test(nextCh)) return 'ś';
    if (/[aAoOuU]/.test(nextCh)) return 'ł';
    if (/[eE]/.test(prev)) return 'ń';
    return 'ń';
  }
  return '\uFFFD';
}

function decodeUtf8Loose(bytes: Uint8Array): string {
  const chars: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] ?? 0;
    if (b < 0x80) {
      chars.push(String.fromCharCode(b));
      i += 1;
      continue;
    }
    if (b >= 0xc2 && b <= 0xdf) {
      const next = bytes[i + 1];
      if (next !== undefined && (next & 0xc0) === 0x80) {
        chars.push(String.fromCharCode(((b & 0x1f) << 6) | (next & 0x3f)));
        i += 2;
        continue;
      }
      chars.push(guessIncompleteLead(b, next, chars[chars.length - 1] ?? ''));
      i += 1;
      continue;
    }
    if (b >= 0xe0 && b <= 0xef) {
      const n1 = bytes[i + 1];
      const n2 = bytes[i + 2];
      if (n1 !== undefined && n2 !== undefined && (n1 & 0xc0) === 0x80 && (n2 & 0xc0) === 0x80) {
        chars.push(String.fromCodePoint(((b & 0x0f) << 12) | ((n1 & 0x3f) << 6) | (n2 & 0x3f)));
        i += 3;
        continue;
      }
    }
    if (b === 0xb3 && /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(chars[chars.length - 1] ?? '')) {
      chars.push('ó');
      i += 1;
      continue;
    }
    if (b >= 0x80 && b <= 0xbf) {
      i += 1;
      continue;
    }
    chars.push('\uFFFD');
    i += 1;
  }
  return chars.join('');
}

function decodeUtf8FromLatin1Chars(text: string): string {
  return decodeUtf8Loose(latin1BytesFromString(text));
}

const MOJIBAKE_MARK = /[ÄÅÃÂ]|[\u0080-\u009F]|™|„|ƒ|š|ž|œ/;

/** UTF-8 bytes that were decoded as Windows-1252/ISO-8859-1 (`DziÄ™kujÄ™` → `Dziękuję`). */
export function repairMojibake(text: string): string {
  if (!text) return text;
  let current = text;
  for (let pass = 0; pass < 3; pass += 1) {
    if (!MOJIBAKE_MARK.test(current) && !current.includes('³')) break;
    const next = decodeUtf8FromLatin1Chars(current);
    if (scoreDecodedText(next) >= scoreDecodedText(current)) current = next;
    else break;
  }
  const fallback = polishMojibakeFallback(current);
  return scoreDecodedText(fallback) >= scoreDecodedText(current) ? fallback : current;
}

function polishMojibakeFallback(text: string): string {
  return text
    .replace(/Å\uFFFD/g, 'ń')
    .replace(/Ä\uFFFD/g, 'ę')
    .replace(/Ã\uFFFD/g, 'ó')
    .replace(/DzieÅ(?=[\s.,;:!?…]|$)/g, 'Dzień')
    .replace(/siÄ(?=[\s.,;:!?…]|$)/g, 'się')
    .replace(/([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż])³/g, '$1ó')
    .replace(/Ån/g, 'śn')
    .replace(/Åc/g, 'śc')
    .replace(/Åa/g, 'ła')
    .replace(/Äd/g, 'ęd')
    .replace(/Ät/g, 'ąt');
}

export function decodeBytesAsText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  let latin1 = '';
  for (let i = 0; i < bytes.length; i += 1) latin1 += String.fromCharCode(bytes[i] ?? 0);
  const repairedUtf8 = repairMojibake(utf8);
  const repairedLatin1 = repairMojibake(latin1);
  const options = [utf8, repairedUtf8, repairedLatin1];
  let best = options[0] ?? '';
  let bestScore = scoreDecodedText(best);
  for (const option of options.slice(1)) {
    const score = scoreDecodedText(option);
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }
  return best;
}

/** Numeric entities, then named Polish ones, then `&amp;` — two passes for double encoding. */
export function decodeHtmlEntities(value: string): string {
  if (!value || !value.includes('&')) return value;
  const limited = value.length > 200_000 ? value.slice(0, 200_000) : value;
  let current = limited;
  for (let pass = 0; pass < 2; pass += 1) {
    current = current
      .replace(/&#x([0-9a-fA-F]{1,6});?/g, (_, hex: string) => fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d{1,7});?/g, (_, dec: string) => fromCharCode(Number(dec)))
      .replace(/&([a-zA-Z]{2,16});?/g, (match, name: string) => NAMED_ENTITIES[name] ?? match);
  }
  return current;
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return repairMojibake(decodeHtmlEntities(stripped))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function listContentStyle(extra?: { gap?: number; paddingBottom?: number }) {
  return {
    padding: 16,
    paddingRight: __DEV__ ? 56 : 16,
    paddingBottom: extra?.paddingBottom ?? (__DEV__ ? 96 : 40),
    gap: extra?.gap ?? 12,
  };
}

export function gradeToNumber(value: string): number | null {
  const key = value.trim().replace(',', '.');
  const map: Record<string, number> = {
    '6': 6,
    '6-': 5.75,
    '5+': 5.5,
    '5': 5,
    '5-': 4.75,
    '4+': 4.5,
    '4': 4,
    '4-': 3.75,
    '3+': 3.5,
    '3': 3,
    '3-': 2.75,
    '2+': 2.5,
    '2': 2,
    '2-': 1.75,
    '1+': 1.5,
    '1': 1,
  };
  return map[key] ?? null;
}

export function formatAverage(values: number[]): string {
  if (values.length === 0) return '—';
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return average.toFixed(2).replace('.', ',');
}

export function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function fullName(first?: string, last?: string): string {
  return repairMojibake(decodeHtmlEntities([first, last].filter(Boolean).join(' ').trim()));
}
