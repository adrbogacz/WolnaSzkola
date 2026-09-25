import type { SchoolMessage } from '@/src/librus/types';

export function replyTopic(topic: string): string {
  const trimmed = topic.trim();
  if (!trimmed) return 'Re:';
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function quotedReply(sender: string, body: string): string {
  const text = body.trim();
  if (!text) return '';
  const who = sender.trim() ? `${sender.trim()} napisał(a):` : 'Wiadomość:';
  return `\n\n---\n${who}\n${text}`;
}

const FIELD_LABEL = /^(nadawca|adresat|odbiorca|temat|data|data wysłania|do|od)$/i;

export function isMessageFieldLabel(value: string): boolean {
  return FIELD_LABEL.test(value.trim());
}

/** "Nowak Anna (Nowak Anna) [Nauczyciel]" → "Nowak Anna [Nauczyciel]". */
export function tidySenderLabel(value: string): string {
  let text = value.replace(/\s+/g, ' ').trim();
  const duplicated = text.match(/^(.*?)\s*\(\s*\1\s*\)\s*(\[[^\]]+\])?\s*$/i);
  if (duplicated?.[1]) {
    text = `${duplicated[1].trim()}${duplicated[2] ? ` ${duplicated[2]}` : ''}`.trim();
  }
  return text;
}

export function alignMessageFields(topic: string, sender: string): { topic: string; sender: string } {
  let nextTopic = topic.replace(/\s+/g, ' ').trim();
  let nextSender = tidySenderLabel(sender);
  if (isMessageFieldLabel(nextTopic)) nextTopic = '';
  if (isMessageFieldLabel(nextSender)) nextSender = '';

  if (!nextTopic && nextSender && !looksLikePersonName(nextSender)) {
    nextTopic = nextSender;
    nextSender = '';
  }

  if (nextTopic && nextSender && looksLikePersonName(nextTopic) && !looksLikePersonName(nextSender)) {
    const swap = nextTopic;
    nextTopic = nextSender;
    nextSender = tidySenderLabel(swap);
  }

  if (isMessageFieldLabel(nextTopic)) nextTopic = '';
  if (isMessageFieldLabel(nextSender)) nextSender = '';

  return {
    topic: nextTopic || '(bez tematu)',
    sender: nextSender || 'Szkoła',
  };
}

export function composeReplyParams(message: SchoolMessage): {
  receiverId: string;
  receiverName: string;
  topic: string;
  replyToId: string;
} {
  const aligned = alignMessageFields(message.topic, message.sender);
  return {
    receiverId: message.senderId ?? '',
    receiverName: aligned.sender,
    topic: replyTopic(aligned.topic),
    replyToId: message.id,
  };
}

export function looksLikePersonName(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/\[[^\]]+\]/.test(text)) return true;
  if (/\b(nauczyciel(?:ka)?|psycholog|pedagog|logopeda|wychowawc\w*)\b/i.test(text)) return true;
  if (
    /\b(zajęcia|ogłoszenie|spotkani\w*|zebrani\w*|sprawdzian\w*|wycieczk\w*|informacj\w*|przypomnien\w*|proszę|prosze|organizac\w*|kontakt\w*|rad\w*|delegat\w*|basen\w*|legitymac\w*|frekwenc\w*)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  const words = nameTokens(text);
  return words.length >= 2 && words.length <= 6;
}

export function namesMatch(left?: string, right?: string): boolean {
  const a = nameTokens(left);
  const b = nameTokens(right);
  if (a.length < 2 || b.length < 2) return false;
  return a.every((token) => b.includes(token)) || b.every((token) => a.includes(token));
}

export function nameTokens(value?: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of (value ?? '')
    .toLowerCase()
    .replace(/[()[\],.]/g, ' ')
    .replace(/[—–-]/g, ' ')
    .replace(/\s+(psycholog|pedagog|logopeda|nauczyciel(?:ka)?|wychowawc\w*)\s*/gi, ' ')
    .split(/\s+/)) {
    if (part.length < 2 || seen.has(part)) continue;
    seen.add(part);
    tokens.push(part);
  }
  return tokens;
}
