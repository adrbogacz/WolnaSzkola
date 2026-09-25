import { decodeBytesAsText, decodeHtmlEntities, eachIsoDate, fullName, htmlToText, repairMojibake, weekdaysOf } from '@/src/format';

import type {
  ChildAccount,
  JsonMap,
  SchoolAttendance,
  SchoolDayPlan,
  SchoolGrade,
  SchoolLesson,
  SchoolMessage,
  SchoolReceiver,
} from './types';

export function asRecord(value: unknown): JsonMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonMap)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback = '', maxLength = 20_000): string {
  const text = asRawString(value, fallback, maxLength);
  const decoded = text.includes('&') ? decodeHtmlEntities(text) : text;
  return repairMojibake(decoded);
}

export function asRawString(value: unknown, fallback = '', maxLength = 20_000): string {
  let text = fallback;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' && Number.isFinite(value)) text = String(value);
  if (text.length > maxLength) text = text.slice(0, maxLength);
  return text;
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function classIdFromUrl(value: string): string {
  return value.match(/\/(?:Classes|VirtualClasses)\/(\d+)/i)?.[1] ?? '';
}

export function refId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) return String(value);
  if (typeof value === 'string') {
    const text = value.trim();
    return classIdFromUrl(text) || (text && text !== '0' ? text : '');
  }
  const record = asRecord(value);
  const nested = asString(record.Id ?? record.id ?? record.accountId ?? record.userId ?? record.UserId, '', 80);
  if (nested && nested !== '0') return nested;
  return classIdFromUrl(asString(record.Url ?? record.url, '', 200));
}

export function classIdsFromMe(payload: unknown): string[] {
  const ids = new Set<string>();
  const remember = (value: unknown) => {
    const id = refId(value);
    if (/^\d{1,8}$/.test(id) && id !== '0') ids.add(id);
  };
  const walk = (value: unknown, depth: number) => {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const raw = asRecord(value);
    remember(raw.Class);
    remember(raw.ClassId ?? raw.classId);
    walk(raw.Class, depth + 1);
    walk(raw.Me, depth + 1);
    walk(raw.User, depth + 1);
    walk(raw.Account, depth + 1);
    walk(raw.Student, depth + 1);
  };
  walk(payload, 0);
  return [...ids];
}

export function nameOf(value: unknown): string {
  const record = asRecord(value);
  return (
    asString(record.Name) ||
    fullName(asString(record.FirstName), asString(record.LastName)) ||
    asString(record.Short)
  );
}

export function parseChildren(payload: unknown): ChildAccount[] {
  const root = asRecord(payload);
  return asArray(root.accounts).map((item) => {
    const account = asRecord(item);
    return {
      id: asNumber(account.id),
      login: asString(account.login),
      studentName: asString(account.studentName) || asString(account.login),
      accessToken: asRawString(account.accessToken),
      state: asString(account.state, 'active'),
    };
  });
}

export function jsonList(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value) && value.length > 0) return value;
    const nested = asRecord(value);
    for (const innerKey of [...keys, 'Grade', 'Item', 'Items']) {
      const inner = nested[innerKey];
      if (Array.isArray(inner) && inner.length > 0) return inner;
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) return [inner];
    }
  }
  const data = root.data;
  if (Array.isArray(data) && data.length > 0) return data;
  const nestedData = asRecord(data);
  for (const key of [...keys, 'messages', 'Messages']) {
    if (Array.isArray(nestedData[key]) && (nestedData[key] as unknown[]).length > 0) {
      return nestedData[key] as unknown[];
    }
  }
  return [];
}

export function unwrapMessagePayload(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    const raw = asRecord(current);
    if (raw.Message && typeof raw.Message === 'object' && !Array.isArray(raw.Message)) {
      return raw.Message;
    }
    if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
      const inner = asRecord(raw.data);
      if (inner.messageId || inner.Message || inner.content || inner.topic || inner.Body) {
        return raw.data;
      }
      current = raw.data;
      continue;
    }
    return current;
  }
  return value;
}

export function parseMessages(payload: unknown): SchoolMessage[] {
  if (Array.isArray(payload)) {
    return payload.map((item) => parseMessage(item)).filter((message) => message.id);
  }
  const list = jsonList(payload, ['Messages', 'messages', 'data']);
  return list.map((item) => parseMessage(item)).filter((message) => message.id);
}

export function parseMessage(value: unknown): SchoolMessage {
  const raw = asRecord(unwrapMessagePayload(value));
  const sender = asRecord(raw.Sender ?? raw.sender ?? raw.from);
  const id = asString(raw.messageId ?? raw.message_id ?? raw.Id ?? raw.id);
  const body = decodeMessageBody(
    firstText(
      raw.Body,
      raw.body,
      raw.Message,
      raw.message,
      raw.content,
      raw.originalMessage,
      raw.Content,
    ),
  );
  const senderName =
    nameOf(sender) ||
    (typeof raw.sender === 'string' ? asString(raw.sender) : '') ||
    asString(raw.senderName) ||
    asString(raw.SenderName) ||
    fullName(asString(raw.senderFirstName ?? sender.FirstName), asString(raw.senderLastName ?? sender.LastName)) ||
    'Szkoła';

  return {
    id,
    topic: asString(raw.Subject ?? raw.topic ?? raw.Topic ?? raw.title, '(bez tematu)'),
    body,
    sentAt: asString(raw.SendDate ?? raw.sendDate ?? raw.Date ?? raw.sentAt),
    sender: senderName,
    senderId: pickSenderId(raw) || undefined,
    read: Boolean(raw.ReadDate ?? raw.readDate) || asBoolean(raw.IsRead) || asBoolean(raw.read),
    hasAttachments:
      asBoolean(raw.HasAttachments) ||
      asBoolean(raw.isAnyFileAttached) ||
      asArray(raw.files).length > 0 ||
      asArray(raw.Attachments).length > 0,
    kind: 'inbox',
  };
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = asString(value, '', 50_000);
    if (text.trim()) return text;
  }
  return '';
}

function pickSenderId(raw: JsonMap): string {
  return (
    refId(raw.Sender ?? raw.sender ?? raw.from) ||
    asString(
      raw.senderId ??
        raw.SenderId ??
        raw.userId ??
        raw.UserId ??
        raw.accountId ??
        raw.AccountId ??
        raw.teacherId ??
        raw.TeacherId,
      '',
      80,
    )
  );
}

function decodeMessageBody(value: string): string {
  try {
    const compact = value.replace(/\s+/g, '');
    if (compact.length >= 16 && /^[A-Za-z0-9+/]+=*$/.test(compact)) {
      const binary = globalThis.atob(compact);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const decoded = decodeBytesAsText(bytes);
      const inner = decoded.match(/<Content>([\s\S]*?)<\/Content>/i)?.[1] ?? decoded;
      if (inner.includes('<') || inner.includes(' ') || /[ąćęłńóśźżÄÅÃ]/i.test(inner)) {
        return htmlToText(inner);
      }
    }
  } catch {
    // Plain text / HTML.
  }
  return htmlToText(value);
}

export function parseSchoolNotices(payload: unknown, users: Map<string, string>): SchoolMessage[] {
  const root = asRecord(payload);
  return asArray(root.SchoolNotices)
    .map((item) => {
      const raw = asRecord(item);
      const id = asString(raw.Id);
      const addedBy = refId(raw.AddedBy);
      return {
        id: id ? `a-${id}` : '',
        topic: asString(raw.Subject ?? raw.Topic ?? raw.Title, '(ogłoszenie)'),
        body: htmlToText(asString(raw.Content ?? raw.Body ?? raw.Text, '', 50_000)),
        sentAt: asString(raw.CreationDate ?? raw.StartDate ?? raw.AddDate ?? raw.Date),
        sender: nameOf(raw.AddedBy) || users.get(addedBy) || 'Szkoła',
        senderId: addedBy || undefined,
        read: asBoolean(raw.WasRead) || asBoolean(raw.IsRead) || asBoolean(raw.read),
        hasAttachments: false,
        kind: 'notice' as const,
      };
    })
    .filter((item) => item.id);
}

export function parseReceivers(payload: unknown, group?: string, typeId?: string): SchoolReceiver[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => receiverFrom(item, group, typeId))
      .filter((receiver) => receiver.id && receiver.name);
  }
  const root = asRecord(payload);
  const candidates = [
    ...asArray(root.Users),
    ...asArray(root.Receivers),
    ...asArray(root.ReceiversGroup),
    ...asArray(root.receivers),
    ...asArray(root.data),
  ];
  if (candidates.length === 0 && (root.Id || root.id || root.accountId)) {
    candidates.push(root);
  }

  const receivers = candidates.map((item) => {
    const raw = asRecord(item);
    const nested = asArray(raw.Users).length > 0 ? asArray(raw.Users) : asArray(raw.receivers);
    if (nested.length > 0) {
      const nestedGroup = group || asString(raw.Name) || asString(raw.GroupName) || asString(raw.Type);
      const nestedType = typeId || asString(raw.symbol ?? raw.type ?? raw.typeId, '', 80);
      return nested.map((user) => receiverFrom(user, nestedGroup || undefined, nestedType || undefined));
    }
    return [receiverFrom(raw, group, typeId)];
  });

  return receivers.flat().filter((receiver) => receiver.id && receiver.name);
}

function receiverFrom(value: unknown, group?: string, typeId?: string): SchoolReceiver {
  const raw = asRecord(value);
  return {
    id: asString(raw.Id ?? raw.id ?? raw.accountId ?? raw.userId ?? raw.receiverId, '', 80),
    name:
      nameOf(raw) ||
      asString(raw.user) ||
      asString(raw.accountName) ||
      asString(raw.fullName) ||
      asString(raw.login) ||
      asString(raw.Id),
    group: group || asString(raw.Group) || asString(raw.GroupName) || undefined,
    typeId: typeId || asString(raw.typeId ?? raw.type ?? raw.symbol ?? raw.typAdresata, '', 80) || undefined,
  };
}

export function parseWiadomosciReceiverCatalog(payload: unknown): SchoolReceiver[] {
  const out: SchoolReceiver[] = [];
  walkReceiverNode(payload, '', '', out, 0);
  return out.filter((item, index, all) => {
    const key = `${item.id}:${item.group ?? ''}:${item.typeId ?? ''}`;
    return all.findIndex((other) => `${other.id}:${other.group ?? ''}:${other.typeId ?? ''}` === key) === index;
  });
}

export function parseWiadomosciReceiverTypes(
  payload: unknown,
): Array<{ id: string; label: string; classIds: string[]; apiId?: string }> {
  const list = jsonList(payload, ['data', 'types', 'receiverTypes']);
  return list
    .map((item) => {
      const raw = asRecord(item);
      const typeValue = raw.symbol ?? raw.type ?? raw.typeId ?? raw.typAdresata ?? raw.receiverType;
      const symbol =
        typeof typeValue === 'object'
          ? asString(asRecord(typeValue).symbol ?? asRecord(typeValue).id, '', 80)
          : asString(typeValue, '', 80);
      const apiId = asString(raw.Id ?? raw.id, '', 80);
      const id = symbol || apiId;
      const label = asString(raw.name ?? raw.Name ?? raw.label ?? raw.Label, id);
      const classIds = uniqueClassIds([
        asString(raw.classId ?? raw.ClassId, '', 80),
        ...classIdsFromUnknown(raw.classes),
        ...classIdsFromUnknown(raw.Classes),
        ...classIdsFromUnknown(raw.classIds),
        ...classIdsFromUnknown(raw.class),
      ]);
      return { id, label, classIds, apiId: apiId && apiId !== id ? apiId : undefined };
    })
    .filter((item) => item.id && !looksLikePersonReceiver(asRecord(item), item.id, item.label));
}

export function extractReceiverClassIds(payload: unknown): string[] {
  const ids = new Set<string>();
  const remember = (value: unknown) => {
    const text = asString(value, '', 80);
    if (/^\d{1,8}$/.test(text) && text !== '0') ids.add(text);
  };
  const walk = (value: unknown, keyHint: string, depth: number) => {
    if (depth > 8 || value == null) return;
    if (typeof value === 'number' || typeof value === 'string') {
      if (/class/i.test(keyHint)) remember(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, keyHint, depth + 1);
      return;
    }
    const raw = asRecord(value);
    for (const [key, nested] of Object.entries(raw)) {
      if (/^(id|Id|classId|ClassId)$/.test(key) && /class/i.test(keyHint)) remember(nested);
      else walk(nested, key, depth + 1);
    }
  };
  walk(payload, '', 0);
  return [...ids];
}

function classIdsFromUnknown(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'number' || typeof value === 'string') {
    const text = asString(value, '', 80);
    return /^\d{1,8}$/.test(text) && text !== '0' ? [text] : [];
  }
  return asArray(Array.isArray(value) ? value : [value])
    .flatMap((entry) => {
      if (typeof entry === 'number' || typeof entry === 'string') return classIdsFromUnknown(entry);
      const raw = asRecord(entry);
      return classIdsFromUnknown(raw.Id ?? raw.id ?? raw.classId ?? raw.ClassId);
    })
    .filter(Boolean);
}

function uniqueClassIds(values: string[]): string[] {
  return [...new Set(values.filter((value) => /^\d{1,8}$/.test(value) && value !== '0'))];
}

function walkReceiverNode(
  value: unknown,
  group: string,
  typeId: string,
  out: SchoolReceiver[],
  depth: number,
) {
  if (depth > 6 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) walkReceiverNode(item, group, typeId, out, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const raw = asRecord(value);
  const typeValue = raw.symbol ?? raw.type ?? raw.typeId ?? raw.typAdresata;
  const nextType =
    (typeof typeValue === 'object' ? asString(asRecord(typeValue).symbol ?? asRecord(typeValue).id, '', 80) : asString(typeValue, '', 80)) ||
    typeId;
  const nextGroup = asString(raw.label ?? raw.Label ?? raw.Group ?? raw.group, '', 120) || group;
  const nested = [
    raw.classes,
    raw.Classes,
    raw.receivers,
    raw.Receivers,
    raw.users,
    raw.Users,
    raw.accounts,
    raw.data,
    raw.items,
  ];
  for (const child of nested) {
    if (child == null) continue;
    walkReceiverNode(child, nextGroup || asString(raw.name ?? raw.Name), nextType, out, depth + 1);
  }

  const personId = asString(raw.accountId ?? raw.userId ?? raw.receiverId, '', 80);
  const genericId = asString(raw.Id ?? raw.id, '', 80);
  const name =
    fullName(asString(raw.firstName ?? raw.FirstName), asString(raw.lastName ?? raw.LastName)) ||
    asString(raw.fullName ?? raw.accountName) ||
    asString(raw.name ?? raw.Name);
  const id = personId || genericId;
  if (!looksLikePersonReceiver(raw, id, name)) return;
  out.push({
    id,
    name,
    group: nextGroup || group || undefined,
    typeId: nextType || undefined,
  });
}

function looksLikePersonReceiver(raw: JsonMap, id: string, name: string): boolean {
  if (!id || !name || name.length > 90) return false;
  if (
    /^(wychowawca|nauczyciel|rodzic|opiekun|rada|admin|grupa|sekretariat|bibliotekarz|psycholog|pedagog|logopeda|teacher|parent|tutor)$/i.test(
      id,
    )
  ) {
    return false;
  }
  if (
    /^(rodzice|nauczyciele|wychowawcy|opiekunowie|sekretariat|bibliotek|administrat|grupa adresat|rady klasowe|szkolna rada|psycholog|pedagodzy|logopedz)/i.test(
      name,
    )
  ) {
    return false;
  }
  const first = asString(raw.firstName ?? raw.FirstName);
  const last = asString(raw.lastName ?? raw.LastName);
  if (first && last) return true;
  if (asString(raw.accountId ?? raw.userId ?? raw.receiverId ?? raw.accountName)) return true;
  if (!/^\d{4,}$/.test(id)) return false;
  return /[a-ząćęłńóśźż]/i.test(name) && /\s/.test(name);
}

export function looksLikeGradeMark(value: string): boolean {
  const mark = value.trim().replace(/\s+/g, '');
  if (!mark || mark.length > 8) return false;
  return /^(?:[0-6][+-]?|np|bz|nb|zw|nk|cel|bdb|db|dst|dop|ndst)$/i.test(mark);
}

export function parseGrades(
  payload: unknown,
  subjects: Map<string, string>,
  categories: Map<string, string>,
  users: Map<string, string>,
  comments: Map<string, string>,
  skills: Map<string, string> = new Map(),
): SchoolGrade[] {
  const list = jsonList(payload, [
    'Grades',
    'DescriptiveGrades',
    'DescriptiveTextGrades',
    'DescriptiveLessonGrades',
    'TextGrades',
    'PointGrades',
    'grades',
    'data',
  ]);
  return list
    .map((item, index) => {
      const raw = asRecord(item);
      const skillId = refId(raw.Skill ?? raw.Ability);
      const picked = pickGradeMark(raw);
      const subjectId = refId(raw.Subject);
      const categoryId = refId(raw.Category);
      const categoryName = nameOf(raw.Category) || categories.get(categoryId);
      const skillName =
        nameOf(raw.Skill) ||
        nameOf(raw.Ability) ||
        asString(raw.SkillName) ||
        asString(raw.Competence) ||
        skills.get(skillId) ||
        (categoryName ? '' : skills.get(picked));
      let value = picked;
      const gradeLooksLikeSkill =
        Boolean(skillName) &&
        !categoryName &&
        (picked === skillId || (skillId === '' && skills.has(picked)));
      if (gradeLooksLikeSkill) {
        value = pickGradeMark(raw, new Set([picked, skillId]));
      }
      const teacherId = refId(raw.AddedBy ?? raw.Teacher);
      const commentId = refId(raw.Comments ?? raw.Comment);
      let comment =
        comments.get(commentId) ||
        firstText(raw.Comment, raw.Comments, raw.Description, raw.Text, raw.Content);
      if (skillName && comment === skillName) comment = '';
      if (skillName && comment && comment !== skillName) {
        comment = comment.replace(new RegExp(`^${skillName}\\s*\\n?`, 'i'), '').trim();
      }
      if (value.length > 24) {
        if (comment && comment !== value) comment = `${value}\n${comment}`;
        else comment = value;
        value = 'opis';
      }
      const id = asString(raw.Id ?? raw.id) || `g-${subjectId || 'x'}-${asString(raw.Date ?? raw.AddDate)}-${index}`;
      return {
        id,
        value,
        subject: nameOf(raw.Subject) || subjects.get(subjectId) || asString(raw.SubjectName) || 'Przedmiot',
        subjectId,
        category:
          skillName ||
          nameOf(raw.Category) ||
          categories.get(categoryId) ||
          (value === 'opis' ? 'Ocena opisowa' : 'Ocena'),
        date: asString(raw.Date ?? raw.AddDate ?? raw.date),
        teacher: nameOf(raw.AddedBy) || nameOf(raw.Teacher) || users.get(teacherId) || '',
        comment: comment || undefined,
        semester: asNumber(raw.Semester, 1),
        isSemester: asBoolean(raw.IsSemester),
        isFinal: asBoolean(raw.IsFinal),
        isProposition: asBoolean(raw.IsSemesterProposition) || asBoolean(raw.IsFinalProposition),
        isFormative: Boolean(skillName && !categoryName) || asBoolean(raw.IsFormative),
      };
    })
    .filter((item) => item.id);
}

function pickGradeMark(raw: JsonMap, skipValues: Set<string> = new Set()): string {
  const nested = asRecord(raw.Grade);
  const relatedIds = [raw.Category, raw.Skill, raw.Kind, raw.Ability].map(refId).filter(Boolean);
  const skip = new Set([...relatedIds, ...skipValues]);
  const candidates = [
    typeof raw.Grade === 'string' || typeof raw.Grade === 'number' ? asString(raw.Grade) : '',
    asString(raw.grade),
    firstText(nested.Name, nested.Grade, nested.Short, nested.Value, nested.Description),
    asString(raw.GradeValue ?? raw.GradeText ?? raw.GradeSymbol ?? raw.Mark ?? raw.Rating ?? raw.Symbol),
    asString(raw.Value),
  ];
  for (const candidate of candidates) {
    const mark = candidate.trim().replace(/\s+/g, '');
    if (mark && !skip.has(mark) && looksLikeGradeMark(mark)) return mark;
  }
  const descriptive = firstText(raw.Description, raw.Text, raw.Content);
  if (descriptive && !/^\d{1,4}$/.test(descriptive)) return descriptive;
  return '';
}

export function parseLookup(payload: unknown, listKey: string): Map<string, string> {
  const map = new Map<string, string>();
  const list = jsonList(payload, [listKey]);
  for (const item of list) {
    const raw = asRecord(item);
    const id = asString(raw.Id ?? raw.id);
    const label = nameOf(raw) || asString(raw.Text) || asString(raw.Content);
    if (id && label) map.set(id, label);
  }
  return map;
}

export function parseAttendance(
  payload: unknown,
  types: Map<string, { name: string; short: string; isPresence: boolean; color: string }>,
  lessons: Map<string, string>,
): SchoolAttendance[] {
  const root = asRecord(payload);
  return asArray(root.Attendances).map((item) => {
    const raw = asRecord(item);
    const typeId = refId(raw.Type);
    const lessonId = refId(raw.Lesson);
    const type = types.get(typeId);
    return {
      id: asString(raw.Id),
      date: asString(raw.Date),
      lessonNo: asNumber(raw.LessonNo, 0),
      typeName: type?.name || nameOf(raw.Type) || 'Frekwencja',
      typeShort: type?.short || asString(asRecord(raw.Type).Short, '?'),
      isPresence: type?.isPresence ?? false,
      color: type?.color || '#78716C',
      subject: lessons.get(lessonId) || nameOf(asRecord(raw.Lesson).Subject),
    };
  });
}

export function parseAttendanceTypes(
  payload: unknown,
): Map<string, { name: string; short: string; isPresence: boolean; color: string }> {
  const map = new Map<string, { name: string; short: string; isPresence: boolean; color: string }>();
  for (const item of asArray(asRecord(payload).Types)) {
    const raw = asRecord(item);
    const id = asString(raw.Id);
    if (!id) continue;
    map.set(id, {
      name: asString(raw.Name, 'Frekwencja'),
      short: asString(raw.Short, '?'),
      isPresence: asBoolean(raw.IsPresenceKind),
      color: `#${asString(raw.ColorRGB, '78716C').replace('#', '')}`,
    });
  }
  return map;
}

export function parseLessonsLookup(payload: unknown, subjects: Map<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of asArray(asRecord(payload).Lessons)) {
    const raw = asRecord(item);
    const id = asString(raw.Id);
    const subject = nameOf(raw.Subject) || subjects.get(refId(raw.Subject));
    if (id && subject) map.set(id, subject);
  }
  return map;
}

export function parseTimetable(payload: unknown): SchoolDayPlan[] {
  const timetable = asRecord(asRecord(payload).Timetable);
  return Object.keys(timetable)
    .sort()
    .map((date) => ({
      date,
      lessons: asArray(timetable[date])
        .flatMap((slot, index) => asArray(slot).map((item, inner) => parseLesson(item, index, inner)))
        .filter((lesson): lesson is SchoolLesson => lesson !== null),
    }));
}

function parseLesson(value: unknown, slotIndex: number, innerIndex: number): SchoolLesson | null {
  const raw = asRecord(value);
  const subject = asRecord(raw.Subject);
  const teacher = asRecord(raw.Teacher);
  const classroom = asRecord(raw.Classroom);
  const subjectName = nameOf(subject);
  const hourFrom = asString(raw.HourFrom);
  const hourTo = asString(raw.HourTo);
  if (!subjectName && !hourFrom && !asBoolean(raw.IsCanceled) && !asBoolean(raw.IsSubstitutionClass)) {
    return null;
  }
  return {
    id: `${refId(raw.TimetableEntry) || refId(raw.Lesson) || slotIndex}-${innerIndex}`,
    subject: subjectName || 'Lekcja',
    teacher: nameOf(teacher),
    classroom: nameOf(classroom) || asString(classroom.Symbol),
    hourFrom,
    hourTo,
    cancelled: asBoolean(raw.IsCanceled) || asBoolean(raw.Canceled),
    substitution: asBoolean(raw.IsSubstitutionClass) || asBoolean(raw.Substitution),
    substitutionNote: asString(raw.SubstitutionNote || raw.Reason) || undefined,
  };
}

export type CalendarDayMark = {
  date: string;
  label: string;
  kind: 'free' | 'note';
};

export function parseFreeDayRanges(
  payload: unknown,
  listKey: string,
  types?: Map<string, string>,
): CalendarDayMark[] {
  const root = asRecord(payload);
  const list = asArray(root[listKey]).length > 0 ? asArray(root[listKey]) : asArray(root.data);
  const marks: CalendarDayMark[] = [];
  for (const item of list) {
    const raw = asRecord(item);
    const from = asString(raw.DateFrom ?? raw.dateFrom ?? raw.Date ?? raw.date).slice(0, 10);
    if (!from) continue;
    const to = asString(raw.DateTo ?? raw.dateTo, from).slice(0, 10) || from;
    const typeId = refId(raw.Type);
    const label =
      asString(raw.Name ?? raw.name) ||
      nameOf(raw.Type) ||
      (typeId && types ? types.get(typeId) : undefined) ||
      'Dzień wolny od zajęć';
    for (const date of eachIsoDate(from, to)) {
      marks.push({ date, label, kind: 'free' });
    }
  }
  return marks;
}

export function parseCalendarNotes(payload: unknown): CalendarDayMark[] {
  const root = asRecord(payload);
  const list = [
    ...asArray(root.Calendars),
    ...asArray(root.Calendar),
    ...asArray(root.Events),
    ...asArray(root.data),
  ];
  return list
    .map((item) => {
      const raw = asRecord(item);
      const date = asString(raw.Date ?? raw.date ?? raw.DateFrom ?? raw.From).slice(0, 10);
      const label =
        asString(raw.Name ?? raw.name ?? raw.Title ?? raw.Subject ?? raw.Content) ||
        nameOf(raw.Category) ||
        nameOf(raw.Type);
      if (!date || !label) return null;
      const kind: CalendarDayMark['kind'] = looksLikeFreeDay(label) ? 'free' : 'note';
      return { date, label, kind };
    })
    .filter((item): item is CalendarDayMark => item !== null);
}

export function mergeWeekPlan(
  weekStart: string,
  days: SchoolDayPlan[],
  marks: CalendarDayMark[],
): SchoolDayPlan[] {
  const byDate = new Map<string, SchoolDayPlan>();
  for (const day of days) {
    byDate.set(day.date, { ...day, notes: day.notes ? [...day.notes] : [] });
  }

  for (const date of weekdaysOf(weekStart)) {
    if (!byDate.has(date)) byDate.set(date, { date, lessons: [], notes: [] });
  }

  for (const mark of marks) {
    if (!byDate.has(mark.date)) continue;
    const current = byDate.get(mark.date)!;
    if (mark.kind === 'free') {
      current.free = true;
      current.freeLabel = current.freeLabel || mark.label;
    } else if (mark.label && !(current.notes ?? []).includes(mark.label) && mark.label !== current.freeLabel) {
      current.notes = [...(current.notes ?? []), mark.label];
    }
  }

  const weekHasLessons = [...byDate.values()].some((day) => day.lessons.length > 0);
  for (const day of byDate.values()) {
    if (day.lessons.length === 0 && weekHasLessons && !day.free && !day.freeLabel) {
      day.freeLabel = 'Brak zajęć';
    }
  }

  return weekdaysOf(weekStart).map((date) => byDate.get(date)!);
}

function looksLikeFreeDay(label: string): boolean {
  return /woln|święt|swiet|ferie|wakac|edukacji narodow|rekolekc|wigilia|wielkanoc|dzień dziecka|nowy rok/i.test(
    label,
  );
}
