import { decodeHtmlEntities, htmlToText, isoDate } from '@/src/format';
import { alignMessageFields, isMessageFieldLabel, looksLikePersonName, namesMatch } from '@/src/reply';

import { looksLikeGradeMark } from './normalize';
import type { SchoolGrade, SchoolMessage, SchoolReceiver } from './types';

export function isLoginHtml(html: string): boolean {
  return /name=["']pass["']/i.test(html) && /name=["']login["']/i.test(html);
}

export function isAccessDeniedHtml(html: string): boolean {
  return /brak dostępu|nie masz uprawnie|brak uprawnie/i.test(html);
}

export function htmlPageHint(html: string): string {
  const plain = (chunk: string) =>
    htmlToText(chunk)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  const title = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const heading = plain(
    html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i)?.[1] ??
      html.match(/class="inside"[^>]*>([\s\S]*?)</i)?.[1] ??
      '',
  );
  const flags = [
    /grade-box/i.test(html) ? 'box' : '',
    /class="ocena"/i.test(html) ? 'ocena' : '',
    /gateway\/app|id=["']root["']|ng-app/i.test(html) ? 'spa' : '',
    /wybierz ucznia|zmien_ucznia|user-switch/i.test(html) ? 'picker' : '',
    /Oceny ucznia|przegladaj_oceny/i.test(html) ? 'oceny' : '',
    /nie masz uprawnie|brak uprawnie|brak dostępu/i.test(html) ? 'denied' : '',
    /uczen_index|icon-oceny/i.test(html) ? 'menu' : '',
  ]
    .filter(Boolean)
    .join(',');
  const text = htmlToText(html).replace(/\s+/g, ' ').trim().slice(0, 160);
  return `title=${title} h=${heading} flags=${flags || '-'} text=${text}`;
}

export function extractCsrf(html: string): string | null {
  const patterns = [
    /csrfTokenValue\s*=\s*["']([^"']+)["']/,
    /requestkey["']?\s*[:=]\s*["']([^"']+)["']/i,
    /name=["']requestkey["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']requestkey["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function extractHiddenInputs(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    if (!/type=["']hidden["']/i.test(tag)) continue;
    const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (!name || name === 'wyslij') continue;
    const value = tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? '';
    fields[name] = value;
  }
  return fields;
}

export function parseSendResult(html: string): { ok: boolean; hint: string } {
  if (isLoginHtml(html) || isAccessDeniedHtml(html)) {
    return { ok: false, hint: '' };
  }
  const green =
    html.match(/class="[^"]*green[^"]*container[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|td)>/i)?.[1] ??
    html.match(/container-background[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ??
    '';
  const notice = htmlToText(green);
  const page = htmlToText(html);
  if (/została wysłana|zostala wyslana|wysłano wiadomość/i.test(notice || page)) {
    return { ok: true, hint: notice || 'Wiadomość została wysłana.' };
  }
  if (/nie zosta[łl]a|błędneg[oa] adresat|nieprawidłow[ey] adresat|brak adresat/i.test(notice || page)) {
    return { ok: false, hint: (notice || page).replace(/\s+/g, ' ').trim().slice(0, 180) };
  }
  const errorBox = htmlToText(
    html.match(/class="[^"]*\b(?:container-red|error-box|red container)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|td)>/i)?.[1] ?? '',
  );
  if (errorBox) return { ok: false, hint: errorBox.slice(0, 180) };
  return { ok: false, hint: notice.slice(0, 180) };
}

export function plausibleReceiverId(value?: string): string {
  const id = (value ?? '').trim();
  if (!/^\d{3,12}$/.test(id) || /^0+$/.test(id)) return '';
  return id;
}

export function canonicalRecipientTypeId(typeId: string): string {
  const key = typeId.trim().toLowerCase();
  const map: Record<string, string> = {
    wychowawcy: 'wychowawca',
    nauczyciele: 'nauczyciel',
    rodzice: 'rodzic',
    opiekunowie: 'opiekun',
    rada_klasowa: 'rada',
    rada_rodzicow: 'rada',
    szkolnarada: 'szkolna_rada',
    biblioteka: 'bibliotekarz',
    administrator: 'admin',
    administracja: 'admin',
  };
  return map[key] || key;
}

export function recipientTypeId(group?: string, typeId?: string): string {
  if (typeId?.trim()) return canonicalRecipientTypeId(typeId);
  const reverse: Record<string, string> = {
    Wychowawcy: 'wychowawca',
    Rodzice: 'rodzic',
    Opiekunowie: 'opiekun',
    'Rady klasowe rodziców': 'rada',
    'Szkolna rada rodziców': 'szkolna_rada',
    Nauczyciele: 'nauczyciel',
    Psychologowie: 'psycholog',
    Pedagodzy: 'pedagog',
    Logopedzi: 'logopeda',
    Biblioteka: 'bibliotekarz',
    'Pracownik biblioteki': 'bibliotekarz',
    Sekretariat: 'sekretariat',
    Administracja: 'admin',
    'Administrator Szkoły': 'admin',
    'Grupa adresatów': 'grupa',
  };
  return reverse[group ?? ''] || 'nauczyciel';
}

export function recipientNeedsClass(typeId: string): boolean {
  const id = canonicalRecipientTypeId(typeId);
  if (/szkolna/i.test(id)) return false;
  return /^(rodzic|opiekun|rada|parent|guardian)/i.test(id);
}

export function recipientTypeAliases(typeId: string): string[] {
  const id = canonicalRecipientTypeId(typeId);
  const aliases: Record<string, string[]> = {
    wychowawca: ['wychowawca', 'wychowawcy'],
    nauczyciel: ['nauczyciel', 'nauczyciele'],
    rodzic: ['rodzic', 'rodzice'],
    opiekun: ['opiekun', 'opiekunowie'],
    rada: ['rada', 'rada_klasowa', 'rada_rodzicow'],
    szkolna_rada: ['szkolna_rada', 'szkolnaRada'],
    bibliotekarz: ['bibliotekarz', 'biblioteka'],
    sekretariat: ['sekretariat'],
    admin: ['admin', 'administrator'],
  };
  return [...new Set([typeId, id, ...(aliases[id] ?? [])].filter(Boolean))];
}

export function labelForRecipientType(typeId: string): string {
  return TYPE_LABELS[typeId] || typeId;
}

export function parseLabeledFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const cells = [...(row[1] ?? '').matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) =>
      htmlToText(cell[1] ?? ''),
    );
    if (cells.length < 2) continue;
    const label = (cells[0] ?? '').replace(/:$/, '').trim();
    const value = cells.slice(1).join(' ').trim();
    if (label && value) fields[label] = value;
  }
  return fields;
}

export function extractReplyAddressee(html: string): { id?: string; name?: string } {
  const hidden = extractHiddenInputs(html);
  const fields = parseLabeledFields(html);
  const senderName =
    fields.Nadawca ||
    htmlToText(html.match(/Nadawca[\s\S]{0,240}?<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i)?.[1] ?? '');
  const byName = findDoKogoIdForName(html, senderName);
  const id =
    plausibleReceiverId(hidden.idOdpowiadajacego) ||
    plausibleReceiverId(hidden.idNadawcy) ||
    byName ||
    plausibleReceiverId(hidden.DoKogo) ||
    undefined;
  const name = senderName || labelForDoKogo(html, id);
  return { id, name: name || undefined };
}

function findDoKogoIdForName(html: string, name: string): string | undefined {
  if (!name.trim()) return undefined;
  for (const option of parseDoKogoOptions(html)) {
    if (namesMatch(option.name, name)) return option.id;
  }
  return undefined;
}

function labelForDoKogo(html: string, id?: string): string {
  if (!id) return '';
  const match = parseDoKogoOptions(html).find((option) => option.id === id);
  if (match?.name) return match.name;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labeled = html.match(new RegExp(`<label[^>]*for=["'][^"']*${escaped}["'][^>]*>([\\s\\S]*?)</label>`, 'i'));
  return htmlToText(labeled?.[1] ?? '');
}

function parseDoKogoOptions(html: string): Array<{ id: string; name: string }> {
  const options: Array<{ id: string; name: string }> = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const chunk = row[1] ?? '';
    const id =
      chunk.match(/name=["']DoKogo(?:\[\])?["'][^>]*value=["'](\d+)["']/i)?.[1] ??
      chunk.match(/value=["'](\d+)["'][^>]*name=["']DoKogo(?:\[\])?["']/i)?.[1];
    const name = htmlToText(chunk.match(/<label[^>]*>([\s\S]*?)<\/label>/i)?.[1] ?? '');
    if (id && name) options.push({ id, name });
  }
  return options;
}

const TYPE_LABELS: Record<string, string> = {
  wychowawca: 'Wychowawcy',
  nauczyciel: 'Nauczyciele',
  rodzic: 'Rodzice',
  opiekun: 'Opiekunowie',
  opiekunowie: 'Opiekunowie',
  rada: 'Rady klasowe rodziców',
  rada_klasowa: 'Rady klasowe rodziców',
  szkolna_rada: 'Szkolna rada rodziców',
  bibliotekarz: 'Pracownik biblioteki',
  sekretariat: 'Sekretariat',
  psycholog: 'Psychologowie',
  pedagog: 'Pedagodzy',
  logopeda: 'Logopedzi',
  admin: 'Administrator Szkoły',
  grupa: 'Grupa adresatów',
  librus: 'Pomoc Librus',
};

export const DEFAULT_RECIPIENT_TYPES: Array<{ id: string; label: string }> = [
  { id: 'wychowawca', label: 'Wychowawcy' },
  { id: 'rodzic', label: 'Rodzice' },
  { id: 'opiekun', label: 'Opiekunowie' },
  { id: 'rada', label: 'Rady klasowe rodziców' },
  { id: 'szkolna_rada', label: 'Szkolna rada rodziców' },
  { id: 'nauczyciel', label: 'Nauczyciele' },
  { id: 'bibliotekarz', label: 'Pracownik biblioteki' },
  { id: 'admin', label: 'Administrator Szkoły' },
  { id: 'grupa', label: 'Grupa adresatów' },
  { id: 'sekretariat', label: 'Sekretariat' },
  { id: 'psycholog', label: 'Psychologowie' },
  { id: 'pedagog', label: 'Pedagodzy' },
];

const OPTIONAL_RECIPIENT_TYPES = new Set(['psycholog', 'pedagog', 'logopeda', 'grupa', 'librus']);

export const CORE_RECIPIENT_TYPES = DEFAULT_RECIPIENT_TYPES.filter((item) => !OPTIONAL_RECIPIENT_TYPES.has(item.id));

export function mergeRecipientTypes(
  found: Array<{ id: string; label: string }>,
  extra: Array<{ id: string; label: string }> = DEFAULT_RECIPIENT_TYPES,
): Array<{ id: string; label: string }> {
  const seen = new Set<string>();
  const merged: Array<{ id: string; label: string }> = [];
  for (const type of [...found, ...extra]) {
    const id = canonicalRecipientTypeId(type.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push({ id, label: type.label || TYPE_LABELS[id] || id });
  }
  return merged;
}

export function recipientTypesToFetch(found: Array<{ id: string; label: string }>): Array<{ id: string; label: string }> {
  return mergeRecipientTypes(found, CORE_RECIPIENT_TYPES);
}

export function applyRecipientClassFields(form: URLSearchParams, typeId: string, classId: string): void {
  form.set('typAdresata', typeId);
  if (!classId || !recipientNeedsClass(typeId)) return;
  form.set('klasa_rodzice', classId);
  form.set('klasa_opiekunowie', classId);
  form.set('klasa_rada_rodzicow', classId);
  form.set('klasa', classId);
}

export function parseRecipientTypes(html: string): Array<{ id: string; label: string }> {
  const found: Array<{ id: string; label: string }> = [];
  const seen = new Set<string>();

  const add = (id: string, label?: string) => {
    const key = canonicalRecipientTypeId(id);
    if (!key || seen.has(key) || key === '0') return;
    seen.add(key);
    found.push({ id: key, label: (label || '').trim() || TYPE_LABELS[key] || key });
  };

  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/radio/i.test(tag)) continue;
    if (!/typAdresata|recipiantTypeRadio|adresat/i.test(tag)) continue;
    const id = tag.match(/\bvalue=["']([^"']+)["']/i)?.[1];
    if (!id) continue;
    const around = html.slice(Math.max(0, match.index ?? 0), (match.index ?? 0) + tag.length + 500);
    const label = htmlToText(around.match(/<label[^>]*>([\s\S]*?)<\/label>/i)?.[1] ?? '');
    add(id, label);
  }

  for (const match of html.matchAll(/selectRecipients\(\s*['"]([^'"]+)['"]/gi)) {
    if (match[1]) add(match[1]);
  }

  return found;
}

export function parseRecipientClassIds(html: string): string[] {
  const ids = new Set<string>();
  const remember = (value?: string) => {
    if (value && /^\d{2,}$/.test(value) && value !== '0') ids.add(value);
  };
  for (const match of html.matchAll(
    /selectRecipients\(\s*['"][^'"]+['"]\s*,\s*(?:true|false)\s*,\s*\d+\s*,\s*(\d+)/gi,
  )) {
    remember(match[1]);
  }
  for (const match of html.matchAll(/false\s*,\s*0\s*,\s*(\d+)/g)) {
    remember(match[1]);
  }
  for (const match of html.matchAll(/klasa_(?:rodzice|opiekunowie|rada_rodzicow)["']?\s*[:=]\s*["']?(\d+)/gi)) {
    remember(match[1]);
  }
  for (const match of html.matchAll(/name=["']klasa_[^"']+["'][^>]*value=["'](\d+)["']/gi)) {
    remember(match[1]);
  }
  for (const line of html.split(/\n/)) {
    if (line.length > 400 || !/false\s*,\s*0/.test(line)) continue;
    const nums = line.match(/\d{2,}/g) ?? [];
    remember(nums[nums.length - 1]);
  }
  for (const select of html.matchAll(/<select[^>]*(?:name|id)=["'][^"']*klasa[^"']*["'][^>]*>([\s\S]*?)<\/select>/gi)) {
    for (const option of select[1].matchAll(/value=["'](\d+)["']/gi)) {
      remember(option[1]);
    }
  }
  return [...ids];
}

export function parseInboxHtml(html: string, kind: 'inbox' | 'sent' = 'inbox'): SchoolMessage[] {
  const messages: SchoolMessage[] = [];
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    const link = row.match(/wiadomosci\/1\/(\d+)\/(\d+)/i);
    if (!link?.[1] || !link[2]) continue;
    if (kind === 'sent' && link[1] !== '6') continue;
    if (kind === 'inbox' && link[1] === '6') continue;

    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    const topicIndex = tds.findIndex((td) => /wiadomosci\/1\//i.test(td[0]));
    const cells = tds.map((td) => htmlToText(td[1] ?? '')).filter((cell) => cell.length > 0);
    const titleFromLink = htmlToText(row.match(/<a[^>]*wiadomosci\/1\/[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '');
    const senderFromTd = topicIndex > 0 ? htmlToText(tds[topicIndex - 1]?.[1] ?? '') : '';
    const date =
      cells.find((cell) => /\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}/.test(cell)) ??
      cells[cells.length - 1] ??
      '';
    const topicCell =
      (titleFromLink && !isMessageFieldLabel(titleFromLink) ? titleFromLink : '') ||
      cells.find((cell) => cell !== date && !isMessageFieldLabel(cell) && !/^\d+$/.test(cell) && cell.length > 2) ||
      '';
    const senderCell =
      (senderFromTd && !isMessageFieldLabel(senderFromTd) ? senderFromTd : '') ||
      cells.find(
        (cell) => cell !== topicCell && cell !== date && !isMessageFieldLabel(cell) && !/^\d+$/.test(cell) && cell.length > 2,
      ) ||
      '';
    const aligned = alignMessageFields(topicCell, senderCell);

    messages.push({
      id: `${link[1]}-${link[2]}`,
      topic: aligned.topic,
      body: '',
      sentAt: date,
      sender: aligned.sender,
      read: kind === 'sent' ? true : !/font-weight:\s*bold/i.test(row),
      hasAttachments: /za[lł]acznik|filetype|paperclip/i.test(row),
      kind,
    });
  }

  return uniqueMessages(messages);
}

export function parseMessageDetailHtml(html: string, id: string): SchoolMessage {
  const fields = parseLabeledFields(html);
  const sent = id.startsWith('6-');
  let sender =
    (sent
      ? fields.Adresat || fields.Odbiorca || fields.Do || fields.Nadawca
      : fields.Nadawca || fields.Adresat) ||
    htmlToText(
      html.match(
        sent
          ? /(?:Adresat|Odbiorca)[\s\S]{0,240}?<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i
          : /Nadawca[\s\S]{0,240}?<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i,
      )?.[1] ?? '',
    ) ||
    'Szkoła';
  const topicField =
    fields.Temat ||
    htmlToText(html.match(/Temat[\s\S]{0,240}?<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i)?.[1] ?? '');
  const aligned = alignMessageFields(topicField, sender);
  sender = aligned.sender;
  const topic = aligned.topic;
  const sentAt =
    fields['Data wysłania'] ||
    fields.Data ||
    htmlToText(html.match(/Data(?:\s+wysłania)?[\s\S]{0,240}?<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i)?.[1] ?? '');
  const contentMatch =
    html.match(/container-message-content[^>]*>([\s\S]*?)<\/div>/i) ??
    html.match(/Treść[\s\S]{0,80}?<td[^>]*>([\s\S]*?)<\/td>/i);
  const senderId =
    html.match(/name=["']idOdpowiadajacego["'][^>]*value=["'](\d+)["']/i)?.[1] ||
    html.match(/value=["'](\d+)["'][^>]*name=["']idOdpowiadajacego["']/i)?.[1] ||
    html.match(/data-(?:user|account|teacher|sender)-id=["'](\d+)["']/i)?.[1] ||
    extractReplyAddressee(html).id;

  return {
    id,
    topic,
    body: htmlToText(contentMatch?.[1] ?? ''),
    sentAt,
    sender,
    senderId,
    read: true,
    hasAttachments: /za[lł]acznik|pobierz_zalacznik/i.test(html),
    kind: sent ? 'sent' : 'inbox',
  };
}

export function parseAnnouncementsHtml(html: string): SchoolMessage[] {
  const notices: SchoolMessage[] = [];
  const tables = html.match(/<table[^>]*class="[^"]*decorated[^"]*"[\s\S]*?<\/table>/gi) ?? [];

  for (const table of tables) {
    const topic = htmlToText(table.match(/<thead[\s\S]*?>([\s\S]*?)<\/thead>/i)?.[1] ?? '');
    const sender = htmlToText(table.match(/Dodał[\s\S]{0,80}?<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '') || 'Szkoła';
    const sentAt = htmlToText(
      table.match(/Data publikacji[\s\S]{0,80}?<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '',
    );
    const body = htmlToText(table.match(/Treść[\s\S]{0,80}?<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '');
    if (!topic && !body) continue;

    notices.push({
      id: `a-${slug(sentAt || topic)}-${slug(topic || body)}`,
      topic: topic || '(ogłoszenie)',
      body,
      sentAt,
      sender,
      read: false,
      hasAttachments: false,
      kind: 'notice',
    });
  }

  return notices;
}

function receiverIdFromChunk(chunk: string): string {
  return (
    chunk.match(/name=["']DoKogo(?:\[\])?["'][^>]*value=["']?(\d{3,12})/i)?.[1] ??
    chunk.match(/value=["']?(\d{3,12})["']?[^>]*name=["']DoKogo(?:\[\])?["']/i)?.[1] ??
    chunk.match(/name=["'](?:adresat|receiverId)(?:\[\])?["'][^>]*value=["']?(\d{3,12})/i)?.[1] ??
    plausibleReceiverId(chunk.match(/<label[^>]*for=["'][^"']*?(\d{3,12})["']/i)?.[1])
  );
}

function receiverNameFromChunk(chunk: string): string {
  return (
    htmlToText(chunk.match(/<label[^>]*>([\s\S]*?)<\/label>/i)?.[1] ?? '') ||
    htmlToText(chunk.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '') ||
    htmlToText(chunk.replace(/<input\b[^>]*>/gi, '')).replace(/\s+/g, ' ').trim()
  );
}

export function parseRecipientsHtml(html: string, typeLabel: string, typeId?: string): SchoolReceiver[] {
  const receivers: SchoolReceiver[] = [];
  const seen = new Set<string>();
  const add = (id?: string, name?: string) => {
    const cleanId = plausibleReceiverId(id) || (id ?? '').trim();
    const cleanName = (name ?? '').replace(/\s+/g, ' ').trim();
    if (!cleanId || !/^\d{3,12}$/.test(cleanId) || /^0+$/.test(cleanId)) return;
    if (!cleanName || cleanName.length > 90) return;
    if (/^(zaznacz|wybierz|klasa)\b/i.test(cleanName)) return;
    if (/^[0-9]{1,2}[a-z]?$/i.test(cleanName)) return;
    const key = `${cleanId}:${cleanName.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    receivers.push({
      id: cleanId,
      name: cleanName,
      group: typeLabel || undefined,
      typeId: typeId ? canonicalRecipientTypeId(typeId) : typeId,
    });
  };

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    add(receiverIdFromChunk(row[1] ?? ''), receiverNameFromChunk(row[1] ?? ''));
  }

  if (receivers.length === 0) {
    for (const match of html.matchAll(
      /<(?:div|li)[^>]*class=["'][^"']*\bline[01]\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li)>/gi,
    )) {
      add(receiverIdFromChunk(match[1] ?? ''), receiverNameFromChunk(match[1] ?? ''));
    }
  }

  if (receivers.length === 0) {
    for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
      const tag = match[0];
      if (!/DoKogo|adresat|receiverId/i.test(tag)) continue;
      const id = tag.match(/value=["']?(\d{3,12})/i)?.[1];
      const around = html.slice(Math.max(0, (match.index ?? 0) - 120), (match.index ?? 0) + tag.length + 400);
      add(id, receiverNameFromChunk(around));
    }
  }

  if (receivers.length === 0) {
    for (const match of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
      const attrs = match[1] ?? '';
      const forId = attrs.match(/\bfor=["']([^"']+)["']/i)?.[1] ?? '';
      if (!forId || /klasa/i.test(forId)) continue;
      const id = plausibleReceiverId(forId.match(/(\d{3,12})(?:\D*$)/)?.[1] ?? forId.split(/[_-]/).pop());
      add(id, htmlToText(match[2] ?? ''));
    }
  }

  if (receivers.length === 0) {
    for (const select of html.matchAll(
      /<select[^>]*(?:name|id)=["'][^"']*DoKogo[^"']*["'][^>]*>([\s\S]*?)<\/select>/gi,
    )) {
      for (const option of (select[1] ?? '').matchAll(/<option[^>]*value=["'](\d+)["'][^>]*>([\s\S]*?)<\/option>/gi)) {
        const name = htmlToText(option[2] ?? '');
        if (/wybierz|klasa|wszystk/i.test(name)) continue;
        add(option[1], name);
      }
    }
  }
  return receivers;
}

export function parseGradesHtml(html: string): SchoolGrade[] {
  html = decodeTitleBreaks(stripCanaryGradeMarkup(html));
  const byKey = new Map<string, SchoolGrade>();
  let serial = 0;
  const pushGrade = (grade: SchoolGrade) => {
    const next = finalizeGrade(grade);
    if (!next) return;
    const key = `${next.date}|${next.subject.toLowerCase()}|${next.value}`;
    const existing = byKey.get(key);
    if (!existing || gradeDetailScore(next) > gradeDetailScore(existing)) {
      byKey.set(key, next);
    }
  };

  for (const table of extractLeafTables(html)) {
    const rows = rowsOfLeafTable(table);
    if (rows.length < 2) continue;
    const header = findGradeHeaderRow(rows);
    if (header) {
      const { ocenaIdx, kIdx, obszarIdx, skillIdx, categoryIdx, dateIdx, teacherIdx } = header.cols;
      for (const row of rows.slice(header.index + 1)) {
        const grade = gradeFromHeaderCells(cellTexts(row), {
          ocenaIdx,
          kIdx,
          obszarIdx,
          skillIdx,
          categoryIdx,
          dateIdx,
          teacherIdx,
        });
        if (!grade) continue;
        serial += 1;
        pushGrade({ ...grade, id: grade.id || `html-table-${serial}` });
      }
      continue;
    }
    for (const row of rows) {
      const grade = gradeFromSkillCells(cellTexts(row));
      if (!grade) continue;
      serial += 1;
      pushGrade({ ...grade, id: `html-skill-${serial}` });
    }
  }

  let lastSubject = '';
  const subjectChunks = html.split(/<tr\b/i);
  for (const chunk of subjectChunks) {
    const row = `<tr${chunk}`;
    const subject = subjectFromGradeRow(row);
    if (subject) lastSubject = subject;
    const hasGradeBox = /grade-box|\bocena\b/i.test(row);
    for (const titleMatch of row.matchAll(/\btitle=("([^"]*)"|'([^']*)')/gi)) {
      const title = decodeGradeTitle(titleMatch[2] ?? titleMatch[3] ?? '');
      if (!/Data:|Kategoria:|Umiej|Ocena:|Obszar/i.test(title)) continue;
      const fields = parseGradeTitle(title);
      if (fields.skill) continue;
      let value = fields.mark.trim();
      if (value.length <= 8) value = value.replace(/\s+/g, '');
      if (!looksLikeGradeMark(value)) continue;
      serial += 1;
      const category = fields.category || 'Ocena';
      const hrefId = row.match(/szczegoly\/(\d+)/i)?.[1];
      pushGrade({
        id: hrefId && fields.mark ? `szczegoly-${hrefId}` : `html-title-${serial}`,
        value,
        subject: lastSubject || fields.area || 'Przedmiot',
        subjectId: '',
        category,
        date: parseGradeDateCell(fields.date) || fields.date,
        teacher: fields.teacher,
        comment: fields.comment || undefined,
        semester: fields.semester,
        isSemester: /śródroczn|semestraln/i.test(category),
        isFinal: /roczn|końcow/i.test(category) && !/przewidywan/i.test(category),
        isProposition: /przewidywan|propozyc/i.test(category),
        isFormative: fields.formative,
      });
    }
    for (const anchor of row.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = anchor[1] ?? '';
      const inner = anchor[2] ?? '';
      if (!/grade-box|\bocena\b|szczegoly|title=/i.test(`${attrs}${row.slice(0, 200)}`) && !hasGradeBox) continue;
      const title = decodeGradeTitle(
        attrs.match(/\btitle="([^"]*)"/i)?.[1] ?? attrs.match(/\btitle='([^']*)'/i)?.[1] ?? '',
      );
      if (!/Data:|Kategoria:|Umiej|Ocena:/i.test(title) && !/szczegoly/i.test(attrs)) continue;
      const fields = parseGradeTitle(title);
      const innerMark = htmlToText(inner).replace(/\s+/g, '');
      let value = visibleGradeMark(innerMark, fields);
      if (value.length <= 8) value = value.replace(/\s+/g, '');
      if (!value || /^\d+[,.]\d+$/.test(value)) continue;
      if (!looksLikeGradeMark(value) && value.length > 8) continue;
      const hrefId = attrs.match(/szczegoly\/(\d+)/i)?.[1];
      if (isCanaryGradeMarkup(attrs) || isCanaryGradeId(hrefId)) continue;
      serial += 1;
      const category = fields.skill || fields.category || (value === 'opis' ? 'Ocena opisowa' : 'Ocena');
      pushGrade({
        id: hrefId ? `html-a-${hrefId}` : `html-a-${serial}`,
        value,
        subject: lastSubject || fields.area || 'Przedmiot',
        subjectId: '',
        category,
        date: parseGradeDateCell(fields.date) || fields.date,
        teacher: fields.teacher,
        comment: fields.comment || undefined,
        semester: fields.semester,
        isSemester: /śródroczn|semestraln/i.test(category),
        isFinal: /roczn|końcow/i.test(category) && !/przewidywan/i.test(category),
        isProposition: /przewidywan|propozyc/i.test(category),
        isFormative: fields.formative || Boolean(fields.skill),
      });
    }
  }

  // Mati365/librus-api: visible text of span.grade-box > a, even when the tooltip title is empty.
  for (const box of html.matchAll(/<(?:span|div)[^>]*grade-box[^>]*>[\s\S]*?<\/(?:span|div)>/gi)) {
    const anchor = box[0].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const attrs = anchor[1] ?? '';
    const fields = parseGradeTitle(
      decodeGradeTitle(attrs.match(/\btitle="([^"]*)"/i)?.[1] ?? attrs.match(/\btitle='([^']*)'/i)?.[1] ?? ''),
    );
    const value = visibleGradeMark(htmlToText(anchor[2] ?? '').replace(/\s+/g, ''), fields);
    if (!looksLikeGradeMark(value)) continue;
    const hrefId = attrs.match(/szczegoly\/(\d+)/i)?.[1];
    if (isCanaryGradeMarkup(box[0]) || isCanaryGradeId(hrefId)) continue;
    serial += 1;
    const category = fields.skill || fields.category || 'Ocena';
    pushGrade({
      id: hrefId ? `html-a-${hrefId}` : `html-box-${serial}`,
      value,
      subject: fields.area || 'Przedmiot',
      subjectId: '',
      category,
      date: parseGradeDateCell(fields.date) || fields.date,
      teacher: fields.teacher,
      comment: fields.comment || undefined,
      semester: fields.semester,
      isSemester: false,
      isFinal: false,
      isProposition: false,
      isFormative: fields.formative || Boolean(fields.skill),
    });
  }

  return [...byKey.values()];
}

export function parseGradeDetailIds(html: string): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(/przegladaj_oceny\/szczegoly\/(\d+)/gi)) {
    if (match[1] && match[1] !== '000000') ids.add(match[1]);
  }
  return [...ids];
}

export function parseGradeDetailPage(html: string, id: string): SchoolGrade | null {
  html = decodeTitleBreaks(stripCanaryGradeMarkup(html));
  const scoped = gradeDetailBody(html);
  const labeled = parseLabeledFields(scoped);
  const horizontal = parseHorizontalGradeFields(scoped);
  const parsedHtml = parseGradesHtml(scoped);
  const tableGrade = parsedHtml.find((item) => item.id.startsWith('html-table-') || item.id.startsWith('html-skill-'));
  const fromHtml = tableGrade || parsedHtml[0];
  const text = htmlToText(scoped);
  const plainBoxed: string[] = [];
  const skillBoxed: string[] = [];
  for (const match of scoped.matchAll(/<(?:span|a)[^>]*(?:grade-box|\bocena\b)[^>]*>[\s\S]*?<\/(?:span|a)>/gi)) {
    if (isCanaryGradeMarkup(match[0])) continue;
    const title = decodeGradeTitle(
      match[0].match(/\btitle="([^"]*)"/i)?.[1] ?? match[0].match(/\btitle='([^']*)'/i)?.[1] ?? '',
    );
    const fields = parseGradeTitle(title);
    const mark = visibleGradeMark(htmlToText(match[0]).replace(/\s+/g, ''), fields);
    if (!looksLikeGradeMark(mark)) continue;
    (fields.skill ? skillBoxed : plainBoxed).push(mark);
  }
  const tableOcena = firstGradeMark(horizontal.ocena, horizontal.Ocena, labeled.Ocena, labeled.ocena);
  const value = firstGradeMark(
    plainBoxed.find((mark) => mark !== tableOcena),
    plainBoxed[0],
    tableGrade?.value,
    tableOcena,
    fromHtml?.value,
    skillBoxed.find((mark) => mark !== tableOcena),
    skillBoxed[0],
    text.match(/\bOcena:\s*([0-6][+-]?|np|bz|nb)\b/i)?.[1],
  );
  if (!value) return null;
  const skill =
    pickField(labeled, ['Umiejętność', 'Umiejetnosc', 'Kategoria']) ||
    pickField(horizontal, ['umiejętność', 'umiejetnosc', 'kategoria']) ||
    fromHtml?.category ||
    '';
  const subject =
    pickField(labeled, ['Obszar oceniania', 'Obszar', 'Przedmiot', 'Nazwa']) ||
    pickField(horizontal, ['obszar oceniania', 'obszar', 'przedmiot']) ||
    fromHtml?.subject ||
    htmlToText(html.match(/Przedmiot[\s\S]{0,80}?<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i)?.[1] ?? '');
  const date =
    parseGradeDateCell(
      pickField(labeled, ['Data', 'Data wystawienia']) ||
        pickField(horizontal, ['data', 'data wystawienia']) ||
        fromHtml?.date ||
        '',
    ) ||
    fromHtml?.date ||
    '';
  const teacher =
    pickField(labeled, ['Nauczyciel', 'Dodał', 'Dodal']) ||
    pickField(horizontal, ['nauczyciel', 'dodał', 'dodal']) ||
    fromHtml?.teacher ||
    '';
  return finalizeGrade({
    id: `szczegoly-${id}`,
    value,
    subject: subject && subject !== 'Ocena' ? subject : fromHtml?.subject || 'Przedmiot',
    subjectId: '',
    category: skill && skill !== 'Ocena' ? skill : fromHtml?.category || 'Ocena',
    date,
    teacher,
    comment: labeled.Komentarz || undefined,
    semester: /2/.test(labeled.Semestr || labeled.Okres || horizontal.semestr || '') ? 2 : 1,
    isSemester: /śródroczn|semestraln/i.test(skill),
    isFinal: /roczn|końcow/i.test(skill) && !/przewidywan/i.test(skill),
    isProposition: /przewidywan|propozyc/i.test(skill),
    isFormative: /kształtując/i.test(labeled.K || labeled.Typ || fromHtml?.comment || '') || Boolean(fromHtml?.isFormative),
  });
}

function extractLeafTables(html: string): string[] {
  const tables: string[] = [];
  let remaining = html;
  for (let i = 0; i < 80; i += 1) {
    const match = remaining.match(/<table\b(?:(?!<table\b)[\s\S])*?<\/table>/i);
    if (!match?.[0]) break;
    tables.push(match[0]);
    remaining = remaining.replace(match[0], flattenInnerTable(match[0]));
  }
  return tables;
}

function flattenInnerTable(tableHtml: string): string {
  return tableHtml
    .replace(/^<table\b[^>]*>/i, '')
    .replace(/<\/table>$/i, '')
    .replace(/<\/?(?:tbody|thead|tfoot)[^>]*>/gi, '')
    .replace(/<\/?t[rdh]\b[^>]*>/gi, ' ');
}

function rowsOfLeafTable(tableHtml: string): string[] {
  const inner = tableHtml.replace(/^<table\b[^>]*>/i, '').replace(/<\/table>$/i, '');
  return inner.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
}

function cellTexts(row: string): string[] {
  return [...row.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((cell) =>
    htmlToText(cell[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function gradeDetailScore(grade: SchoolGrade): number {
  return (
    (grade.teacher ? 2 : 0) +
    (grade.category && grade.category !== 'Ocena' && grade.category !== 'Przedmiot' ? 2 : 0) +
    (grade.comment ? 1 : 0) +
    (grade.date ? 1 : 0) +
    (looksLikeGradeMark(grade.value) ? 1 : 0)
  );
}

function findGradeHeaderRow(rows: string[]): {
  index: number;
  cols: {
    ocenaIdx: number;
    kIdx: number;
    obszarIdx: number;
    skillIdx: number;
    categoryIdx: number;
    dateIdx: number;
    teacherIdx: number;
  };
} | null {
  for (let index = 0; index < rows.length; index += 1) {
    const headers = cellTexts(rows[index]).map((cell) => cell.toLowerCase());
    const ocenaIdx = headers.findIndex((cell) => /^ocena$/.test(cell));
    const detailIdx = headers.findIndex((cell) => /kategoria|umiej|obszar/.test(cell));
    const dateIdx = headers.findIndex((cell) => /^data/.test(cell));
    if (ocenaIdx < 0 || (detailIdx < 0 && dateIdx < 0)) continue;
    return {
      index,
      cols: {
        ocenaIdx,
        kIdx: headers.findIndex((cell) => /^k$/.test(cell)),
        obszarIdx: headers.findIndex((cell) => /obszar/.test(cell)),
        skillIdx: headers.findIndex((cell) => /umiej/.test(cell)),
        categoryIdx: headers.findIndex((cell) => /kategoria/.test(cell)),
        dateIdx,
        teacherIdx: headers.findIndex((cell) => /nauczyciel|dodał|dodal/.test(cell)),
      },
    };
  }
  return null;
}

function gradeFromHeaderCells(
  cells: string[],
  cols: {
    ocenaIdx: number;
    kIdx: number;
    obszarIdx: number;
    skillIdx: number;
    categoryIdx: number;
    dateIdx: number;
    teacherIdx: number;
  },
): SchoolGrade | null {
  if (rowLooksLikePeriod(cells)) return null;
  const value = (cells[cols.ocenaIdx] ?? '').replace(/\s+/g, '');
  if (!looksLikeGradeMark(value)) return null;
  const date = parseGradeDateCell(cells[cols.dateIdx] ?? '');
  const teacher = cells[cols.teacherIdx] ?? '';
  const skill = cells[cols.skillIdx] ?? '';
  const area = cells[cols.obszarIdx] ?? '';
  const categoryName = cells[cols.categoryIdx] ?? '';
  const formative = cols.kIdx >= 0 && /^k$/i.test(cells[cols.kIdx] ?? '');
  const category = skill || categoryName || (formative ? 'Ocena kształtująca' : 'Ocena');
  if (!date && !teacher) return null;
  if (!date && !skill && !area) return null;
  return {
    id: '',
    value,
    subject: area || 'Przedmiot',
    subjectId: '',
    category,
    date,
    teacher,
    comment: undefined,
    semester: 1,
    isSemester: false,
    isFinal: false,
    isProposition: false,
    isFormative: formative,
  };
}

function gradeFromSkillCells(cells: string[]): SchoolGrade | null {
  if (cells.length < 4) return null;
  if (rowLooksLikePeriod(cells)) return null;
  const markIdx = cells.findIndex((cell) => looksLikeGradeMark(cell.replace(/\s+/g, '')) && !/^k$/i.test(cell.trim()));
  const dateIdx = cells.findIndex((cell) => Boolean(parseGradeDateCell(cell)));
  if (markIdx < 0 || dateIdx < 0) return null;
  const teacherIdx = cells.findIndex((cell) => looksLikeTeacherCell(cell));
  const others = cells.filter(
    (cell, index) =>
      index !== markIdx &&
      index !== dateIdx &&
      index !== teacherIdx &&
      cell &&
      !/^k$/i.test(cell) &&
      !/^okres/i.test(cell) &&
      !/^\d+[,.]\d+$/.test(cell),
  );
  const area =
    others.find((cell) => /edukacja|język|jezyk|matem|zajęcia|plastyk|muzyk|techn|informat|wychowanie/i.test(cell)) ||
    others[0] ||
    '';
  const skill = others.find((cell) => cell !== area) || '';
  if (!area && !skill) return null;
  const formative = cells.some((cell) => /^k$/i.test(cell.trim()));
  const category = skill || (formative ? 'Ocena kształtująca' : 'Ocena');
  return {
    id: '',
    value: cells[markIdx]?.replace(/\s+/g, '') ?? '',
    subject: area || 'Przedmiot',
    subjectId: '',
    category,
    date: parseGradeDateCell(cells[dateIdx] ?? ''),
    teacher: teacherIdx >= 0 ? cells[teacherIdx] ?? '' : '',
    comment: undefined,
    semester: 1,
    isSemester: false,
    isFinal: false,
    isProposition: false,
    isFormative: formative,
  };
}

function rowLooksLikePeriod(cells: string[]): boolean {
  const text = cells.join(' ').replace(/\s+/g, ' ').trim();
  if (/^okres\s*[12]$/i.test(text)) return true;
  if (cells.some((cell) => /^okres\s*[12]$/i.test(cell))) return true;
  return cells.some((cell) => /^okres$/i.test(cell)) && cells.some((cell) => /^[12]$/.test(cell));
}

function finalizeGrade(grade: SchoolGrade): SchoolGrade | null {
  if (isJunkGrade(grade)) return null;
  return {
    ...grade,
    comment: tidyGradeComment(grade),
    isFormative: grade.isFormative || /kształtując/i.test(grade.comment ?? ''),
  };
}

export function isJunkGrade(grade: SchoolGrade): boolean {
  if (!grade.value) return true;
  const subject = grade.subject.trim();
  const category = grade.category.trim();
  if (/^(przedmiot|ocena)$/i.test(subject) && /^(przedmiot|ocena)?$/i.test(category)) return true;
  const hasId = /\d{3,}/.test(grade.id);
  if (!grade.date && !grade.teacher && !hasId) return true;
  return false;
}

export function tidyGradeComment(grade: SchoolGrade): string | undefined {
  const skip = new Set(
    [
      grade.category,
      grade.subject,
      `umiejętność: ${grade.category}`,
      `umiejetnosc: ${grade.category}`,
      `obszar: ${grade.subject}`,
      `obszar oceniania: ${grade.subject}`,
      'ocena kształtująca',
      'ocena ksztaltujaca',
    ]
      .filter(Boolean)
      .map((value) => value.toLowerCase()),
  );
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of (grade.comment ?? '').split(/\n+/)) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const restated = key.match(/^(?:umiejętność|umiejetnosc|obszar(?:\s+oceniania)?|kategoria):\s*(.*)$/);
    if (restated && (!restated[1] || skip.has(restated[1].trim()) || skip.has(key))) continue;
    if (/^ocena kształtująca$|^ocena ksztaltujaca$/i.test(trimmed) && (grade.isFormative || skip.has(key))) continue;
    if (skip.has(key) || seen.has(key)) continue;
    seen.add(key);
    kept.push(trimmed);
  }
  return kept.join('\n') || undefined;
}

function parseHorizontalGradeFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const table of extractLeafTables(html)) {
    const rows = rowsOfLeafTable(table);
    if (rows.length < 2) continue;
    const header = findGradeHeaderRow(rows);
    if (!header) continue;
    const labels = cellTexts(rows[header.index]);
    const values = cellTexts(rows[header.index + 1] ?? '');
    labels.forEach((label, index) => {
      const key = label.trim().toLowerCase();
      if (key && values[index]) fields[key] = values[index] ?? '';
    });
    if (fields.ocena) break;
  }
  return fields;
}

function pickField(fields: Record<string, string>, labels: string[]): string {
  for (const label of labels) {
    const direct = fields[label];
    if (direct?.trim()) return direct.trim();
    const lower = fields[label.toLowerCase()];
    if (lower?.trim()) return lower.trim();
  }
  return '';
}

function isCanaryGradeId(id?: string): boolean {
  return Boolean(id && /^0+$/.test(id));
}

function isCanaryGradeMarkup(chunk: string): boolean {
  return /id=["']ocenaTest["']/i.test(chunk) || /przegladaj_oceny\/szczegoly\/0{3,}/i.test(chunk);
}

function stripCanaryGradeMarkup(html: string): string {
  return html
    .replace(/<(span|div)([^>]*grade-box[^>]*)>([\s\S]*?)<\/\1>/gi, (full) =>
      isCanaryGradeMarkup(full) ? '' : full,
    )
    .replace(/<a[^>]*id=["']ocenaTest["'][^>]*>[\s\S]*?<\/a>/gi, '');
}

function gradeDetailBody(html: string): string {
  const match = html.match(/<div[^>]*class="[^"]*container-background[^"]*"[^>]*>([\s\S]*)/i);
  const body = match?.[1] ?? '';
  return body.length > 400 && /ocena|grade-box|umiej/i.test(body) ? body : html;
}

export function summarizeGradeDetailHtml(html: string): string {
  const canary = isCanaryGradeMarkup(html);
  const scoped = gradeDetailBody(decodeTitleBreaks(stripCanaryGradeMarkup(html)));
  const labeled = parseLabeledFields(scoped);
  const boxed = [...scoped.matchAll(/<(?:span|a)[^>]*(?:grade-box|\bocena\b)[^>]*>[\s\S]*?<\/(?:span|a)>/gi)]
    .filter((match) => !isCanaryGradeMarkup(match[0]))
    .map((match) => htmlToText(match[0]).replace(/\s+/g, ''))
    .filter((mark) => looksLikeGradeMark(mark))
    .slice(0, 8);
  return `canary=${canary} boxed=${boxed.join(',')} labeledOcena=${(labeled.Ocena ?? '').replace(/\s+/g, '')}`;
}

function visibleGradeMark(inner: string, fields: { mark: string; skill: string }): string {
  const shown = inner.replace(/\s+/g, '').trim();
  if (looksLikeGradeMark(shown)) return shown;
  const titled = fields.mark.replace(/\s+/g, '').trim();
  if (fields.skill && looksLikeGradeMark(titled)) return '';
  return titled;
}

function firstGradeMark(...values: Array<string | undefined>): string {
  for (const value of values) {
    const mark = (value ?? '').replace(/\s+/g, '');
    if (looksLikeGradeMark(mark)) return mark;
  }
  return '';
}

function decodeTitleBreaks(html: string): string {
  return html.replace(/\btitle=("[^"]*"|'[^']*')/gi, (attribute) =>
    attribute.replace(/<br\s*\/?>/gi, '\n').replace(/&lt;br\s*\/?&gt;/gi, '\n'),
  );
}

function decodeGradeTitle(raw: string): string {
  return decodeHtmlEntities(raw.replace(/<br\s*\/?>/gi, '\n').replace(/&lt;br\s*\/?&gt;/gi, '\n'));
}

function looksLikeTeacherCell(value: string): boolean {
  return looksLikePersonName(value) && !/edukacja|język|jezyk|matem|zajęcia|obszar|umieję|okres/i.test(value);
}

function parseGradeDateCell(value: string): string {
  const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const polish = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!polish?.[1] || !polish[2] || !polish[3]) return '';
  return `${polish[3]}-${polish[2].padStart(2, '0')}-${polish[1].padStart(2, '0')}`;
}

function subjectFromGradeRow(row: string): string {
  const header = htmlToText(row.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (header && header.length < 90 && !/^lp\.?$/i.test(header) && !/opublikowano:/i.test(header)) {
    if (
      !/^(ocena|przedmiot|data|nauczyciel|kategoria|umiejętność|umiejetnosc|obszar oceniania|k|dodał|dodal|okres\s*\d)$/i.test(
        header,
      )
    ) {
      return header;
    }
  }
  const cells = [...row.matchAll(/<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi)];
  for (const cell of cells) {
    const attrs = cell[1] ?? '';
    if (/micro|screen-only|grade-box|right/i.test(attrs)) continue;
    const text = htmlToText(cell[2] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text.length > 90 || text.length < 3 || /^lp\.?$/i.test(text)) continue;
    if (/^[0-6][+-]?$|^np$|^bz$|^nb$|^k$|^s$/i.test(text)) continue;
    if (/^\d+[,.]\d+$/.test(text)) continue;
    if (/^(przedmiot|ocena|kategoria|umiejętność|umiejetnosc|obszar(?:\s+oceniania)?|nauczyciel|data)$/i.test(text)) {
      continue;
    }
    return text;
  }
  return '';
}

function parseGradeTitle(title: string): {
  date: string;
  teacher: string;
  category: string;
  skill: string;
  area: string;
  mark: string;
  comment: string;
  semester: number;
  formative: boolean;
} {
  const get = (label: string) => title.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'))?.[1]?.trim() ?? '';
  const semesterRaw = get('Semestr') || get('Okres');
  const counts = get('Licz do średniej') || get('Licz do sredniej');
  return {
    date: get('Data'),
    teacher: get('Nauczyciel') || get('Dodał'),
    category: get('Kategoria'),
    skill: get('Umiejętność') || get('Umiejetnosc'),
    area: get('Obszar oceniania') || get('Obszar') || get('Przedmiot'),
    mark: get('Ocena'),
    comment: get('Komentarz') || get('Treść'),
    semester: /2/.test(semesterRaw) ? 2 : 1,
    formative: /^nie$/i.test(counts) || /^k$/i.test(get('K')),
  };
}

export function parseCalendarHtml(
  html: string,
  year: number,
  month: number,
): Array<{ date: string; label: string; kind: 'free' | 'note' }> {
  const marks: Array<{ date: string; label: string; kind: 'free' | 'note' }> = [];
  const blocks = html.split(/kalendarz-dzien/i).slice(1);
  for (const block of blocks) {
    const dayNum = Number(block.match(/kalendarz-numer-dnia[^>]*>\s*(\d+)/i)?.[1]);
    if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) continue;
    const date = isoDate(new Date(year, month - 1, dayNum, 12));
    const dayOffClass = /class="[^"]*wolne/i.test(block) || /dzień wolny|dzien wolny/i.test(block);
    const text = htmlToText(block.slice(0, 2500));
    const labels = text
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(
        (line) =>
          line.length > 3 &&
          line.length < 80 &&
          !/^\d+$/.test(line) &&
          !/^\d{1,2}:\d{2}/.test(line) &&
          !/^n[rz]\.?$/i.test(line),
      );
    const holiday = labels.find((line) =>
      /woln|święt|swiet|ferie|wakac|edukacji narodow|rekolekc|wigilia|wielkanoc|dzień dziecka|nowy rok/i.test(line),
    );
    if (holiday) {
      marks.push({ date, label: holiday, kind: 'free' });
      continue;
    }
    if (dayOffClass) {
      marks.push({ date, label: 'Dzień wolny od zajęć', kind: 'free' });
    }
  }
  return marks;
}

export function sendSucceeded(html: string): boolean {
  return parseSendResult(html).ok;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function uniqueMessages(messages: SchoolMessage[]): SchoolMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (!message.id || seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}
