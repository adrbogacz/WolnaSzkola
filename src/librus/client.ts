import { addDays, fullName, sortNewest } from '@/src/format';
import { namesMatch } from '@/src/reply';
import { loadSchoolCache, saveSchoolCache } from '@/src/storage';

import { CookieJar, readJson, readResponseText, sessionFetch, sessionFetchFollow } from './http';
import { KlasowaError } from './errors';
import { combineGrades, gradeNumericId } from './gradesCombine';
import {
  INBOX_TTL_MS,
  RECEIVERS_TTL_MS,
  loadWithTtl,
  messageHasBody,
} from './cachePolicy';
import { beginLoginLog, endLoginLog, getLoginLog, logLogin, logNet, maskLogin, sanitizeUrl, summarizeJson } from './loginLog';
import {
  asRecord,
  asString,
  jsonList,
  refId,
  classIdsFromMe,
  parseAttendance,
  parseAttendanceTypes,
  parseCalendarNotes,
  parseFreeDayRanges,
  parseGrades,
  parseLessonsLookup,
  parseLookup,
  parseMessage,
  parseMessages,
  parseReceivers,
  parseSchoolNotices,
  parseTimetable,
  parseWiadomosciReceiverCatalog,
  parseWiadomosciReceiverTypes,
  extractReceiverClassIds,
  mergeWeekPlan,
  unwrapMessagePayload,
} from './normalize';
import { WIADOMOSCI_RECEIVER_TYPE_PATH } from './receiversPlan';
import {
  extractCsrf,
  extractHiddenInputs,
  extractReplyAddressee,
  htmlPageHint,
  isAccessDeniedHtml,
  isLoginHtml,
  parseAnnouncementsHtml,
  parseCalendarHtml,
  parseGradeDetailPage,
  parseGradesHtml,
  summarizeGradeDetailHtml,
  parseInboxHtml,
  parseMessageDetailHtml,
  parseRecipientClassIds,
  parseRecipientTypes,
  parseRecipientsHtml,
  parseSendResult,
  plausibleReceiverId,
  recipientNeedsClass,
  recipientTypeId,
  recipientTypesToFetch,
  applyRecipientClassFields,
  recipientTypeAliases,
  labelForRecipientType,
  canonicalRecipientTypeId,
  CORE_RECIPIENT_TYPES,
} from './scrape';
import type {
  ChildAccount,
  SchoolAttendance,
  SchoolDayPlan,
  SchoolGrade,
  SchoolMessage,
  SchoolReceiver,
  SchoolReceiverGroup,
} from './types';

const API = 'https://api.librus.pl/3.0';
const API_V2 = 'https://api.librus.pl/2.0';
const AUTH = 'https://api.librus.pl';
const SYNERGIA = 'https://synergia.librus.pl';
const WIADOMOSCI = 'https://wiadomosci.librus.pl';
const GATEWAY = `${SYNERGIA}/gateway/api/2.0`;

export class LibrusClient {
  private jar = new CookieJar();
  private email = '';
  private password = '';
  private apiRoot = API;
  private child: ChildAccount | null = null;
  private portalReady = false;
  private wiadomosciReady = false;
  private lastFreshAt = 0;
  private recovering = false;
  private inboxCache: SchoolMessage[] = [];
  private sentCache: SchoolMessage[] = [];
  private noticeCache: SchoolMessage[] = [];
  private receiversCache: SchoolReceiver[] = [];
  private receiverClassIds: string[] = [];
  private inboxAt = 0;
  private sentAt = 0;
  private noticeAt = 0;
  private receiversAt = 0;
  private receiverContext: {
    path: string;
    csrf: string | null;
    types: Array<{ id: string; label: string }>;
  } | null = null;

  get selectedChild(): ChildAccount | null {
    return this.child;
  }

  resetSession(): void {
    this.jar.clear();
    this.email = '';
    this.password = '';
    this.apiRoot = API;
    this.child = null;
    this.portalReady = false;
    this.wiadomosciReady = false;
    this.lastFreshAt = 0;
    this.inboxCache = [];
    this.sentCache = [];
    this.noticeCache = [];
    this.receiversCache = [];
    this.receiverClassIds = [];
    this.inboxAt = 0;
    this.sentAt = 0;
    this.noticeAt = 0;
    this.receiversAt = 0;
    this.receiverContext = null;
  }

  async login(identifier: string, password: string): Promise<ChildAccount[]> {
    beginLoginLog();
    this.jar.clear();
    this.portalReady = false;
    this.wiadomosciReady = false;
    this.lastFreshAt = 0;
    this.child = null;
    this.inboxCache = [];
    this.sentCache = [];
    this.noticeCache = [];
    this.receiversCache = [];
    this.receiverClassIds = [];
    this.inboxAt = 0;
    this.sentAt = 0;
    this.noticeAt = 0;
    this.receiversAt = 0;
    this.receiverContext = null;
    this.email = identifier.trim().replace(/\s+/g, '');
    this.password = password.trim();

    try {
      if (!this.email || !this.password) {
        throw new KlasowaError('Wpisz login i hasło z dziennika.');
      }

      if (this.email.includes('@') || !/^\d+$/.test(this.email)) {
        throw new KlasowaError(
          'W aplikacji Librus logujesz się loginem z dziennika — same cyfry, jak w aplikacji Librus. Nie e-mailem z Gmaila.',
        );
      }

      logLogin(`loginLen=${this.email.length} loginMask=${maskLogin(this.email)} passwordLen=${this.password.length}`);
      return await this.loginNumericOAuth(this.email, this.password);
    } catch (error) {
      logLogin(`FAIL ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof KlasowaError) {
        error.causeDetail = { log: getLoginLog(), extra: error.causeDetail };
      }
      throw error;
    } finally {
      endLoginLog();
    }
  }

  private async loginNumericOAuth(login: string, password: string): Promise<ChildAccount[]> {
    logLogin('oauth: GET portalRodzina (cookie oauth_state)');
    const handshake = await sessionFetchFollow(
      this.jar,
      `${SYNERGIA}/loguj/portalRodzina?v=${Date.now() / 1000}`,
      {
        method: 'GET',
        headers: { Referer: 'https://portal.librus.pl/' },
      },
    );
    await readResponseText(handshake);

    const authUrl = `${AUTH}/OAuth/Authorization?client_id=46`;
    logLogin('oauth: GET Authorization client_id=46');
    const authPage = await sessionFetchFollow(this.jar, authUrl, { method: 'GET' });
    await readResponseText(authPage);

    logLogin('oauth: POST login/pass');
    const posted = await sessionFetch(this.jar, authUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Baner': createBanerHeader(),
        Referer: authUrl,
      },
      body: new URLSearchParams({
        action: 'login',
        login,
        pass: password,
      }).toString(),
    });

    const postedLocation = posted.headers.get('Location') ?? posted.headers.get('location');
    if (posted.status >= 300 && posted.status < 400 && postedLocation) {
      await readResponseText(posted);
      const next = new URL(postedLocation, authUrl).toString();
      logLogin(`oauth-post redirect ${sanitizeUrl(next)}`);
      await sessionFetchFollow(this.jar, next, { method: 'GET' }).then((response) => readResponseText(response));
    } else {
      let postedPayload: {
        status?: string;
        goTo?: string;
        error?: string;
        errors?: Array<{ message?: string }>;
      } = {};
      try {
        postedPayload = (await readJson(posted, authUrl)) as typeof postedPayload;
        logLogin(`oauth-post ${summarizeJson(postedPayload)}`);
      } catch {
        throw new KlasowaError(
          'Nie udało się zalogować. Wpisz login z dziennika (same cyfry) i hasło z aplikacji Librus albo z kartki ze szkoły — nie hasło do Gmaila.',
          posted.status,
        );
      }

      if (!posted.ok || postedPayload.status === 'error' || postedPayload.error) {
        const fromLibrus = postedPayload.errors?.map((item) => item.message).filter(Boolean).join(' ');
        logLogin(`oauth-post rejected librus="${fromLibrus ?? ''}"`);
        throw new KlasowaError(
          fromLibrus ||
            'Nie udało się zalogować. Wpisz login z dziennika (same cyfry) i hasło z aplikacji Librus albo z kartki ze szkoły.',
          posted.status,
        );
      }

      if (postedPayload.goTo) {
        try {
          const nextUrl = oauthNextUrl(postedPayload.goTo);
          logLogin(`oauth goTo=${sanitizeUrl(nextUrl)}`);
          await sessionFetchFollow(this.jar, nextUrl, { method: 'GET' }).then((response) => readResponseText(response));
        } catch (error) {
          logLogin(`oauth goTo skipped ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const tokenInfo = await sessionFetch(this.jar, `${GATEWAY}/Auth/TokenInfo`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    try {
      if (tokenInfo.ok) {
        logLogin(`tokenInfo ${summarizeJson(await readJson(tokenInfo, `${GATEWAY}/Auth/TokenInfo`))}`);
      } else {
        logLogin(`tokenInfo fail ${tokenInfo.status}`);
        await readResponseText(tokenInfo);
      }
    } catch (error) {
      logLogin(`tokenInfo catch ${error instanceof Error ? error.message : String(error)}`);
    }

    for (const root of [GATEWAY, API_V2, API]) {
      try {
        const me = await this.probeMe(root);
        this.apiRoot = root;
        this.child = {
          id: 1,
          login,
          studentName: nameFromMe(me) || login,
          accessToken: '',
          state: 'active',
        };
        this.portalReady = true;
        this.lastFreshAt = Date.now();
        logLogin(`oauth cookie /Me ok root=${root} name=${this.child.studentName}`);
        await this.refreshOauth();
        return [this.child];
      } catch (error) {
        logLogin(`oauth cookie /Me fail root=${root} ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new KlasowaError(
      'Librus przyjął login, ale nie utrzymał sesji na telefonie. Zaloguj się loginem z dziennika jeszcze raz.',
    );
  }

  private async probeMe(root: string, accessToken?: string): Promise<unknown> {
    const url = `${root}/Me`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const response = await sessionFetch(this.jar, url, {
      method: 'GET',
      headers,
    });
    if (!response.ok) {
      throw new KlasowaError('Nie udało się odczytać konta.', response.status);
    }
    return readJson(response, url);
  }

  async listChildren(): Promise<ChildAccount[]> {
    await this.ensurePortal();
    if (!this.child) {
      throw new KlasowaError('Nie udało się odczytać konta z dziennika.');
    }
    return [this.child];
  }

  async selectChild(child: ChildAccount): Promise<void> {
    const same = this.child?.id === child.id && this.child.login === child.login;
    this.child = child;
    if (same) return;
    this.inboxCache = [];
    this.sentCache = [];
    this.noticeCache = [];
    this.receiversCache = [];
    this.inboxAt = 0;
    this.sentAt = 0;
    this.noticeAt = 0;
    this.receiversAt = 0;
  }

  async getMessages(options?: { force?: boolean }): Promise<SchoolMessage[]> {
    const loaded = await loadWithTtl({
      force: options?.force,
      memory: this.inboxAt ? { savedAt: this.inboxAt, data: this.inboxCache } : null,
      ttlMs: INBOX_TTL_MS,
      loadDisk: () => loadSchoolCache<SchoolMessage[]>(this.cacheScope(), 'inbox'),
      fetchNetwork: () => this.fetchMessagesFromNetwork(),
    });
    this.inboxCache = loaded.data;
    this.inboxAt = loaded.entry.savedAt;
    if (loaded.fromNetwork) await saveSchoolCache(this.cacheScope(), 'inbox', loaded.data, loaded.entry.savedAt);
    return loaded.data;
  }

  async peekMessages(): Promise<SchoolMessage[] | null> {
    if (this.inboxCache.length > 0) return this.inboxCache;
    const disk = await loadSchoolCache<SchoolMessage[]>(this.cacheScope(), 'inbox');
    if (!disk?.data) return null;
    this.inboxCache = disk.data;
    this.inboxAt = disk.savedAt;
    return disk.data;
  }

  private async fetchMessagesFromNetwork(): Promise<SchoolMessage[]> {
    let wiadomosciError: unknown;

    try {
      const parsed = parseMessages(
        await this.wiadomosciJson('/api/inbox/messages?page=1&limit=80'),
      ).map((item) => ({ ...item, id: `w-${item.id.replace(/^w-/, '')}` }));
      if (parsed.length > 0) return sortNewest(parsed);
    } catch (error) {
      wiadomosciError = error;
      logNet(`inbox api fail ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const parsed = parseMessages(
        await this.apiJson(
          '/Messages?alternativeBody=true&changeNewLine=1&getAllTypes=1&page=1&limit=80',
        ),
      );
      if (parsed.length > 0) return sortNewest(parsed);
    } catch {
      // Cookie session uses the HTML inbox on synergia.librus.pl.
    }

    try {
      const htmlMessages = await this.scrapeInbox();
      if (htmlMessages.length > 0) return sortNewest(htmlMessages);
    } catch (error) {
      if (!wiadomosciError) wiadomosciError = error;
    }

    if (wiadomosciError) throw wiadomosciError;
    return [];
  }

  async getAnnouncements(options?: { force?: boolean }): Promise<SchoolMessage[]> {
    const loaded = await loadWithTtl({
      force: options?.force,
      memory: this.noticeAt ? { savedAt: this.noticeAt, data: this.noticeCache } : null,
      ttlMs: INBOX_TTL_MS,
      loadDisk: () => loadSchoolCache<SchoolMessage[]>(this.cacheScope(), 'notices'),
      fetchNetwork: () => this.fetchAnnouncementsFromNetwork(),
    });
    this.noticeCache = loaded.data;
    this.noticeAt = loaded.entry.savedAt;
    if (loaded.fromNetwork) await saveSchoolCache(this.cacheScope(), 'notices', loaded.data, loaded.entry.savedAt);
    return loaded.data;
  }

  async peekAnnouncements(): Promise<SchoolMessage[] | null> {
    if (this.noticeCache.length > 0) return this.noticeCache;
    const disk = await loadSchoolCache<SchoolMessage[]>(this.cacheScope(), 'notices');
    if (!disk?.data) return null;
    this.noticeCache = disk.data;
    this.noticeAt = disk.savedAt;
    return disk.data;
  }

  private async fetchAnnouncementsFromNetwork(): Promise<SchoolMessage[]> {
    try {
      const [payload, users] = await Promise.all([
        this.apiJson('/SchoolNotices'),
        this.apiJson('/Users').catch(() => ({ Users: [] })),
      ]);
      const parsed = parseSchoolNotices(payload, parseLookup(users, 'Users'));
      if (parsed.length > 0) return sortNewest(parsed);
    } catch {
      // Fall through to the school notice board HTML.
    }

    const html = await this.synergiaText('/ogloszenia');
    return sortNewest(parseAnnouncementsHtml(html));
  }

  async getSentMessages(options?: { force?: boolean }): Promise<SchoolMessage[]> {
    const loaded = await loadWithTtl({
      force: options?.force,
      memory: this.sentAt ? { savedAt: this.sentAt, data: this.sentCache } : null,
      ttlMs: INBOX_TTL_MS,
      loadDisk: () => loadSchoolCache<SchoolMessage[]>(this.cacheScope(), 'sent'),
      fetchNetwork: () => this.fetchSentMessagesFromNetwork(),
    });
    this.sentCache = loaded.data;
    this.sentAt = loaded.entry.savedAt;
    if (loaded.fromNetwork) await saveSchoolCache(this.cacheScope(), 'sent', loaded.data, loaded.entry.savedAt);
    return loaded.data;
  }

  async peekSentMessages(): Promise<SchoolMessage[] | null> {
    if (this.sentCache.length > 0) return this.sentCache;
    const disk = await loadSchoolCache<SchoolMessage[]>(this.cacheScope(), 'sent');
    if (!disk?.data) return null;
    this.sentCache = disk.data;
    this.sentAt = disk.savedAt;
    return disk.data;
  }

  private async fetchSentMessagesFromNetwork(): Promise<SchoolMessage[]> {
    try {
      for (const path of ['/api/outbox/messages?page=1&limit=80', '/api/sent/messages?page=1&limit=80']) {
        try {
          const parsed = parseMessages(await this.wiadomosciJson(path)).map((item) => ({
            ...item,
            id: `w-${item.id.replace(/^w-/, '')}`,
            kind: 'sent' as const,
            read: true,
          }));
          if (parsed.length > 0) return sortNewest(parsed);
        } catch {
          // Next outbox endpoint, then HTML.
        }
      }
    } catch {
      logNet('outbox api fail, trying HTML folder 6');
    }

    return sortNewest(await this.scrapeSent());
  }

  async getMessage(id: string, options?: { force?: boolean }): Promise<SchoolMessage> {
    const normalized = normalizeMessageId(id);
    if (!normalized) throw new KlasowaError('Nie udało się otworzyć wiadomości.');

    if (normalized.startsWith('a-')) {
      const notices = this.noticeCache.length > 0 ? this.noticeCache : await this.getAnnouncements();
      const found = notices.find((item) => item.id === normalized);
      if (!found) throw new KlasowaError('Nie znaleziono ogłoszenia.');
      return found;
    }

    const cached = await this.cachedMessageWithBody(normalized);
    if (!options?.force && cached && messageHasBody(cached)) return cached;
    const numericId = normalized.replace(/^w-/, '').match(/(\d+)$/)?.[1] ?? '';
    const preferSent = cached?.kind === 'sent';

    if (normalized.startsWith('w-') || /^\d+$/.test(normalized)) {
      const mid = encodeURIComponent(normalized.replace(/^w-/, ''));
      const primaryPath = preferSent ? `/api/outbox/messages/${mid}` : `/api/inbox/messages/${mid}`;
      const payload = await this.wiadomosciJsonOrNull(primaryPath);
      if (payload) {
        const parsed = parseMessage(unwrapMessagePayload(payload));
        if (parsed.topic || parsed.body) {
          return this.rememberOpenedMessage(
            mergeMessages(
              {
                ...parsed,
                id: normalized.startsWith('w-') ? normalized : parsed.id || normalized,
                kind: preferSent ? 'sent' : cached?.kind || 'inbox',
              },
              cached,
            ),
          );
        }
      }

      if (numericId) {
        const folderId = preferSent ? '6' : '5';
        try {
          const html = await this.synergiaText(`/wiadomosci/1/${folderId}/${numericId}`);
          const detailed = parseMessageDetailHtml(html, normalized);
          if (detailed.body || (detailed.topic && detailed.topic !== '(bez tematu)')) {
            return this.rememberOpenedMessage(
              mergeMessages({ ...detailed, id: normalized, kind: folderId === '6' ? 'sent' : 'inbox' }, cached),
            );
          }
        } catch {
          // Cache below.
        }
      }

      if (cached && (cached.body || cached.topic)) return cached;
    }

    try {
      const payload = await this.apiJson(`/Messages/${encodeURIComponent(numericId || normalized)}`);
      const parsed = parseMessage(unwrapMessagePayload(payload));
      if (parsed.topic || parsed.body) {
        return this.rememberOpenedMessage(mergeMessages({ ...parsed, id: normalized }, cached));
      }
    } catch {
      // HTML inbox.
    }

    const folderAndId = normalized.match(/^(\d+)-(\d+)$/);
    if (folderAndId?.[1] && folderAndId[2]) {
      try {
        const html = await this.synergiaText(`/wiadomosci/1/${folderAndId[1]}/${folderAndId[2]}`);
        const detailed = parseMessageDetailHtml(html, normalized);
        if (detailed.body || detailed.topic) {
          return this.rememberOpenedMessage(
            mergeMessages({ ...detailed, kind: folderAndId[1] === '6' ? 'sent' : cached?.kind || 'inbox' }, cached),
          );
        }
      } catch {
        // Cache below.
      }
    }

    if (cached && (cached.body || cached.topic)) return cached;
    throw new KlasowaError('Nie udało się otworzyć wiadomości.');
  }

  private async cachedMessageWithBody(id: string): Promise<SchoolMessage | undefined> {
    const memory = this.findCachedMessage(id);
    if (messageHasBody(memory)) return memory;
    const disk = await loadSchoolCache<SchoolMessage>(this.cacheScope(), `message:${id}`);
    if (disk?.data) {
      this.rememberOpenedMessage(disk.data, false);
      return disk.data;
    }
    return memory;
  }

  private rememberOpenedMessage(message: SchoolMessage, persist = true): SchoolMessage {
    const list = message.kind === 'sent' ? this.sentCache : this.inboxCache;
    const index = list.findIndex((item) => item.id === message.id);
    if (index >= 0) list[index] = mergeMessages(message, list[index]);
    else list.unshift(message);
    if (persist && messageHasBody(message)) {
      void saveSchoolCache(this.cacheScope(), `message:${message.id}`, message);
    }
    return message;
  }

  private cacheScope(): string {
    return `${this.email || 'anon'}::${this.child?.login || this.child?.id || '0'}`;
  }

  private rememberClassIds(ids: string[]): void {
    const next = [
      ...new Set(
        [...this.receiverClassIds, ...ids].filter((id) => /^\d{1,8}$/.test(id) && id !== '0'),
      ),
    ].slice(0, 2);
    this.receiverClassIds = next;
  }

  private findCachedMessage(id: string): SchoolMessage | undefined {
    const numeric = id.replace(/^w-/, '');
    return (
      this.inboxCache.find((item) => item.id === id || item.id.replace(/^w-/, '') === numeric) ??
      this.sentCache.find((item) => item.id === id || item.id.replace(/^w-/, '') === numeric) ??
      this.noticeCache.find((item) => item.id === id)
    );
  }

  async markServerRead(id: string): Promise<void> {
    if (id.startsWith('w-')) {
      try {
        await this.wiadomosciJson(`/api/inbox/messages/${encodeURIComponent(id.slice(2))}`);
      } catch {
        // Local read flag still applies.
      }
    }
  }

  async hideOnServer(id: string, action: 'archived' | 'deleted'): Promise<void> {
    if (id.startsWith('a-')) return;

    if (id.startsWith('w-')) {
      const mid = encodeURIComponent(id.slice(2));
      const attempts =
        action === 'deleted'
          ? [
              () => this.wiadomosciMutate(`/api/inbox/messages/${mid}`, { method: 'DELETE' }),
              () => this.wiadomosciMutate(`/api/inbox/messages/${mid}/trash`, { method: 'POST', body: '{}' }),
              () =>
                this.wiadomosciMutate(`/api/inbox/messages/${mid}`, {
                  method: 'PUT',
                  body: JSON.stringify({ trash: true }),
                }),
            ]
          : [
              () => this.wiadomosciMutate(`/api/inbox/messages/${mid}/archive`, { method: 'POST', body: '{}' }),
              () =>
                this.wiadomosciMutate(`/api/inbox/messages/${mid}`, {
                  method: 'PUT',
                  body: JSON.stringify({ archive: true }),
                }),
              () =>
                this.wiadomosciMutate('/api/inbox/archive', {
                  method: 'POST',
                  body: JSON.stringify({ messageIds: [id.slice(2)] }),
                }),
            ];

      for (const attempt of attempts) {
        try {
          if (await attempt()) return;
        } catch {
          // Try the next endpoint.
        }
      }
      throw new KlasowaError('Nie udało się zsynchronizować z dziennikiem.');
    }

    const folderAndId = id.match(/^(\d+)-(\d+)$/);
    if (folderAndId?.[1] && folderAndId[2]) {
      const ok = await this.hideHtmlMessage(folderAndId[1], folderAndId[2], action);
      if (ok) return;
    }

    throw new KlasowaError('Nie udało się zsynchronizować z dziennikiem.');
  }

  async listReceivers(options?: { force?: boolean }): Promise<SchoolReceiver[]> {
    return this.listReceiversForGroup('wychowawca', options);
  }

  async peekReceivers(): Promise<SchoolReceiver[] | null> {
    const people = await this.peekReceiversForGroup('wychowawca');
    return people && people.length > 0 ? people : null;
  }

  async peekReceiverGroups(): Promise<SchoolReceiverGroup[]> {
    const [groups, classIds] = await Promise.all([
      loadSchoolCache<SchoolReceiverGroup[]>(this.cacheScope(), 'receiverGroups'),
      loadSchoolCache<string[]>(this.cacheScope(), 'classIds'),
    ]);
    if (classIds?.data?.length) this.rememberClassIds(classIds.data);
    if (groups?.data?.length) {
      this.receiverContext = this.receiverContext ?? {
        path: '/wiadomosci/2/5',
        csrf: null,
        types: recipientTypesToFetch(groups.data),
      };
    }
    return recipientTypesToFetch(groups?.data ?? []);
  }

  async peekReceiversForGroup(typeId: string): Promise<SchoolReceiver[] | null> {
    const id = canonicalRecipientTypeId(typeId);
    const memory = this.receiversCache.filter(
      (item) => canonicalRecipientTypeId(item.typeId || recipientTypeId(item.group)) === id,
    );
    if (memory.length > 0) return memory;
    const [entry, classIds] = await Promise.all([
      loadSchoolCache<SchoolReceiver[]>(this.cacheScope(), `receivers:${id}`),
      loadSchoolCache<string[]>(this.cacheScope(), 'classIds'),
    ]);
    if (classIds?.data?.length) this.rememberClassIds(classIds.data);
    if (!entry?.data?.length) return null;
    this.mergeReceiverCache(entry.data);
    return entry.data;
  }

  async listReceiverGroups(options?: { force?: boolean }): Promise<SchoolReceiverGroup[]> {
    const loaded = await loadWithTtl({
      force: options?.force,
      memory: this.receiverContext
        ? { savedAt: this.receiversAt || Date.now(), data: this.receiverContext.types }
        : null,
      ttlMs: RECEIVERS_TTL_MS,
      loadDisk: () => loadSchoolCache<SchoolReceiverGroup[]>(this.cacheScope(), 'receiverGroups'),
      fetchNetwork: async () => {
        const context = await this.ensureReceiverContext(true);
        return context.types;
      },
    });
    const types = recipientTypesToFetch(loaded.data);
    if (loaded.fromNetwork) {
      await saveSchoolCache(this.cacheScope(), 'receiverGroups', types, loaded.entry.savedAt);
    }
    return types;
  }

  async listReceiversForGroup(typeId: string, options?: { force?: boolean }): Promise<SchoolReceiver[]> {
    const id = canonicalRecipientTypeId(typeId);
    const cacheKey = `receivers:${id}`;
    const memoryPeople = this.receiversCache.filter(
      (item) => canonicalRecipientTypeId(item.typeId || recipientTypeId(item.group)) === id,
    );
    const loaded = await loadWithTtl({
      force: options?.force,
      memory: !options?.force && memoryPeople.length > 0 && this.receiversAt
        ? { savedAt: this.receiversAt, data: memoryPeople }
        : null,
      ttlMs: memoryPeople.length > 0 ? RECEIVERS_TTL_MS : INBOX_TTL_MS,
      loadDisk: () => loadSchoolCache<SchoolReceiver[]>(this.cacheScope(), cacheKey),
      fetchNetwork: () => this.fetchReceiversForType(id),
    });
    this.mergeReceiverCache(loaded.data);
    if (loaded.fromNetwork && loaded.data.length > 0) {
      await saveSchoolCache(this.cacheScope(), cacheKey, loaded.data, loaded.entry.savedAt);
      await saveSchoolCache(this.cacheScope(), 'classIds', this.receiverClassIds, loaded.entry.savedAt);
    }
    return loaded.data;
  }

  private mergeReceiverCache(people: SchoolReceiver[]): void {
    this.receiversCache = uniqueReceivers([...people, ...this.receiversCache]);
    this.receiversAt = Date.now();
  }

  private async ensureReceiverContext(force = false): Promise<{
    path: string;
    csrf: string | null;
    types: Array<{ id: string; label: string }>;
  }> {
    if (this.receiverContext && !force) return this.receiverContext;
    try {
      await this.wiadomosciReceivers();
    } catch {
      // HTML compose still has types and class ids.
    }

    let page: { path: string; html: string; csrf: string | null } | null = null;
    for (const composePath of ['/wiadomosci/2/5', '/wiadomosci/2/6']) {
      try {
        const html = await this.synergiaText(composePath);
        if (isLoginHtml(html)) continue;
        page = { path: composePath, html, csrf: extractCsrf(html) };
        break;
      } catch (error) {
        logNet(`html receivers ${composePath} fail ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!page) {
      this.receiverContext = { path: '/wiadomosci/2/5', csrf: null, types: CORE_RECIPIENT_TYPES };
      return this.receiverContext;
    }

    this.rememberClassIds(parseRecipientClassIds(page.html));
    const types = recipientTypesToFetch(parseRecipientTypes(page.html));
    this.receiverContext = { path: page.path, csrf: page.csrf, types };
    console.warn(
      `[WSMSG] receiver context types=${types.map((item) => item.id).join(',')} classes=${this.receiverClassIds.join(',') || '-'}`,
    );
    return this.receiverContext;
  }

  private async fetchReceiversForType(typeId: string): Promise<SchoolReceiver[]> {
    const context = await this.ensureReceiverContext();
    const id = canonicalRecipientTypeId(typeId);
    const type =
      context.types.find((item) => item.id === id) ?? {
        id,
        label: labelForRecipientType(id),
      };
    if (recipientNeedsClass(type.id) && this.receiverClassIds.length === 0) {
      const probe = await this.postGetRecipients('rodzic', '', context.csrf, context.path);
      this.rememberClassIds(this.classIdsFromRecipientResponse(probe.text));
      if (this.receiverClassIds.length === 0) {
        this.rememberClassIds(await this.extraSchoolClassIds());
      }
    }
    const classIds = recipientNeedsClass(type.id)
      ? this.receiverClassIds.slice(0, 2)
      : ['', ...this.receiverClassIds.slice(0, 1)];
    if (recipientNeedsClass(type.id) && classIds.length === 0) {
      console.warn(`[WSMSG] html group ${type.id} skipped, no class id`);
      return [];
    }

    for (const alias of recipientTypeAliases(type.id)) {
      for (const classId of classIds.length > 0 ? classIds : ['']) {
        const extra = await this.fetchRecipientGroup(alias, type.label, context.csrf, context.path, classId);
        console.warn(`[WSMSG] html group ${type.id} alias=${alias} class=${classId || '-'} n=${extra.length}`);
        if (extra.length > 0) {
          return extra.map((item) => ({ ...item, typeId: type.id, group: type.label }));
        }
      }
    }
    return [];
  }

  private classIdsFromRecipientResponse(text: string): string[] {
    const ids = [...parseRecipientClassIds(text)];
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        ids.push(...extractReceiverClassIds(JSON.parse(trimmed) as unknown));
      } catch {
        // HTML fragment.
      }
    }
    return ids;
  }

  async resolveReplyAddressee(messageId: string): Promise<{ id: string; name: string } | null> {
    const numeric = messageId.match(/(\d+)$/)?.[1];
    if (!numeric) return null;
    for (const path of [`/wiadomosci/3/5/${numeric}`, `/wiadomosci/3/6/${numeric}`, `/wiadomosci/1/5/${numeric}`]) {
      try {
        const html = await this.synergiaText(path);
        const found = extractReplyAddressee(html);
        if (found.id || found.name) {
          logNet(
            `reply addressee path=${path} idLen=${(found.id ?? '').length} name=${(found.name ?? '').slice(0, 60)}`,
          );
          return { id: found.id || '', name: found.name || '' };
        }
      } catch {
        // Next reply URL.
      }
    }
    return null;
  }

  async sendMessage(input: {
    receiverId: string;
    topic: string;
    body: string;
    replyToId?: string;
    receiverTypeId?: string;
  }): Promise<void> {
    const topic = input.topic.trim();
    const body = input.body.trim();
    if (!topic || !body) {
      throw new KlasowaError('Wpisz temat i treść wiadomości.');
    }

    const replyTo = input.replyToId?.replace(/^w-/, '');
    try {
      if (await this.sendMessageHtml(input.receiverId, topic, body, replyTo, input.receiverTypeId)) {
        this.inboxAt = 0;
        this.sentAt = 0;
        return;
      }
    } catch (error) {
      if (error instanceof KlasowaError) {
        throw error;
      }
    }
    throw new KlasowaError(
      'Nie udało się wysłać wiadomości. Spróbuj jeszcze raz albo wyślij przez synergia.librus.pl.',
    );
  }

  async getGrades(): Promise<SchoolGrade[]> {
    let apiGrades: SchoolGrade[] = [];
    let skillIds = new Set<string>();
    let apiError: unknown;
    try {
      const api = await this.gradesFromApi();
      apiGrades = api.grades;
      skillIds = api.skillIds;
    } catch (error) {
      apiError = error;
      logNet(`grades api fail ${error instanceof Error ? error.message : String(error)}`);
    }

    const apiIds = apiGrades.map((grade) => gradeNumericId(grade.id)).filter(Boolean);
    const details = await this.fetchGradeDetails(apiIds);

    let htmlGrades: SchoolGrade[] = [];
    let htmlError: unknown;
    try {
      htmlGrades = await this.gradesFromHtml();
    } catch (error) {
      htmlError = error;
      logNet(`grades html fail ${error instanceof Error ? error.message : String(error)}`);
    }

    const extraIds = htmlGrades
      .map((grade) => gradeNumericId(grade.id))
      .filter((id) => id && !apiIds.includes(id));
    const extraDetails = extraIds.length > 0 ? await this.fetchGradeDetails(extraIds) : [];
    const allDetails = [...details, ...extraDetails];
    const merged = combineGrades({
      html: htmlGrades,
      details: allDetails,
      api: apiGrades,
      skillIds,
    });
    const summarize = (items: SchoolGrade[]) =>
      items
        .slice(0, 6)
        .map((item) => `${item.id}:${item.value}/${item.category}`)
        .join('|');
    console.warn(
      `[WSGRADES] html=${htmlGrades.length}[${summarize(htmlGrades)}] api=${apiGrades.length}[${summarize(apiGrades)}] details=${allDetails.length}[${summarize(allDetails)}] skills=${skillIds.size} merged=${merged.length}[${summarize(merged)}]`,
    );
    logNet(
      `grades merged html=${htmlGrades.length} api=${apiGrades.length} details=${allDetails.length} total=${merged.length} sample=${merged[0] ? `${merged[0].value}/${merged[0].category}` : '-'}`,
    );
    if (merged.length > 0) return merged;
    if (apiError && htmlError) {
      throw apiError instanceof Error ? apiError : htmlError;
    }
    return [];
  }

  async getAttendance(): Promise<SchoolAttendance[]> {
    const [attendances, types, lessons, subjects] = await Promise.all([
      this.apiJson('/Attendances'),
      this.apiJson('/Attendances/Types'),
      this.apiJson('/Lessons').catch(() => ({ Lessons: [] })),
      this.apiJson('/Subjects').catch(() => ({ Subjects: [] })),
    ]);

    return parseAttendance(
      attendances,
      parseAttendanceTypes(types),
      parseLessonsLookup(lessons, parseLookup(subjects, 'Subjects')),
    );
  }

  async getTimetable(weekStart: string): Promise<SchoolDayPlan[]> {
    const start = new Date(`${weekStart}T12:00:00`);
    const friday = addDays(start, 4);
    const months = [{ year: start.getFullYear(), month: start.getMonth() + 1 }];
    if (friday.getMonth() !== start.getMonth() || friday.getFullYear() !== start.getFullYear()) {
      months.push({ year: friday.getFullYear(), month: friday.getMonth() + 1 });
    }
    const [table, schoolFree, classFree, classFreeTypes, calendars, ...htmlGroups] = await Promise.all([
      this.apiJson(`/Timetables?weekStart=${encodeURIComponent(weekStart)}`).catch(() => ({})),
      this.apiJson('/SchoolFreeDays').catch(() => ({})),
      this.apiJson('/ClassFreeDays').catch(() => ({})),
      this.apiJson('/ClassFreeDays/Types').catch(() => ({})),
      this.apiJson('/Calendars').catch(() => ({})),
      ...months.map((item) => this.calendarMarksFromHtml(item.year, item.month).catch(() => [])),
    ]);
    const classTypes = parseLookup(classFreeTypes, 'Types');
    const marks = [
      ...parseFreeDayRanges(schoolFree, 'SchoolFreeDays'),
      ...parseFreeDayRanges(classFree, 'ClassFreeDays', classTypes),
      ...parseCalendarNotes(calendars),
      ...htmlGroups.flat(),
    ];
    const days = mergeWeekPlan(weekStart, parseTimetable(table), marks);
    logNet(
      `timetable week=${weekStart} lessons=${days.reduce((sum, day) => sum + day.lessons.length, 0)} free=${days.filter((day) => day.free).length}`,
    );
    return days;
  }

  private async calendarMarksFromHtml(
    year: number,
    month: number,
  ): Promise<Array<{ date: string; label: string; kind: 'free' | 'note' }>> {
    const html = await this.synergiaText('/terminarz');
    let parsed = parseCalendarHtml(html, year, month);
    if (parsed.length === 0) {
      const csrf = extractCsrf(html);
      const headers: Record<string, string> = {
        Accept: 'text/html,application/xhtml+xml',
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${SYNERGIA}/terminarz`,
      };
      if (csrf) headers.requestkey = csrf;
      const response = await sessionFetch(this.jar, `${SYNERGIA}/terminarz`, {
        method: 'POST',
        headers,
        body: new URLSearchParams({ rok: String(year), miesiac: String(month) }).toString(),
      });
      parsed = parseCalendarHtml(await readResponseText(response), year, month);
    }
    return parsed;
  }

  private async gradesFromApi(): Promise<{ grades: SchoolGrade[]; skillIds: Set<string> }> {
    const [
      grades,
      textGrades,
      pointGrades,
      descriptive,
      descriptiveText,
      descriptiveLesson,
      subjects,
      categories,
      users,
      comments,
      descriptiveSkills,
      textSkills,
    ] = await Promise.all([
      this.apiJson('/Grades').catch(() => ({})),
      this.apiJson('/TextGrades').catch(() => ({})),
      this.apiJson('/PointGrades').catch(() => ({})),
      this.apiJson('/DescriptiveGrades').catch(() => ({})),
      this.apiJson('/DescriptiveTextGrades').catch(() => ({})),
      this.apiJson('/DescriptiveLessonGrades').catch(() => ({})),
      this.apiJson('/Subjects').catch(() => ({ Subjects: [] })),
      this.apiJson('/Grades/Categories').catch(() => ({ Categories: [] })),
      this.apiJson('/Users').catch(() => ({ Users: [] })),
      this.apiJson('/Grades/Comments').catch(() => ({ Comments: [] })),
      this.apiJson('/DescriptiveGrades/Skills').catch(() => ({})),
      this.apiJson('/DescriptiveTextGrades/Skills').catch(() => ({})),
    ]);
    const subjectMap = parseLookup(subjects, 'Subjects');
    const categoryMap = parseLookup(categories, 'Categories');
    const userMap = parseLookup(users, 'Users');
    const commentMap = parseLookup(comments, 'Comments');
    const skillMap = new Map([
      ...parseLookup(descriptiveSkills, 'Skills'),
      ...parseLookup(textSkills, 'Skills'),
    ]);
    const sample = jsonList(grades, ['Grades', 'grades', 'data'])[0];
    if (sample) {
      const raw = asRecord(sample);
      const sampleId = asString(raw.Id ?? raw.id);
      console.warn(
        `[WSGRADES] api sample id=${sampleId} grade=${asString(raw.Grade)} skill=${refId(raw.Skill)} kind=${refId(raw.Kind)} color=${asString(raw.Color)} keys=${Object.keys(raw).join(',')}`,
      );
      if (sampleId) {
        await this.apiJson(`/Grades/${sampleId}`)
          .then((detail) => console.warn(`[WSGRADES] api grade ${sampleId} ${summarizeJson(detail)}`))
          .catch((error) =>
            console.warn(
              `[WSGRADES] api grade ${sampleId} fail ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
      }
      logNet(`grades api sample ${summarizeJson(sample)}`);
    }
    const parsed = [
      ...parseGrades(grades, subjectMap, categoryMap, userMap, commentMap, skillMap),
      ...parseGrades(textGrades, subjectMap, categoryMap, userMap, commentMap, skillMap),
      ...parseGrades(pointGrades, subjectMap, categoryMap, userMap, commentMap, skillMap),
      ...parseGrades(descriptive, subjectMap, categoryMap, userMap, commentMap, skillMap),
      ...parseGrades(descriptiveText, subjectMap, categoryMap, userMap, commentMap, skillMap),
      ...parseGrades(descriptiveLesson, subjectMap, categoryMap, userMap, commentMap, skillMap),
    ];
    logNet(`grades api count=${parsed.length} skills=${skillMap.size}`);
    return {
      grades: parsed.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index),
      skillIds: new Set(skillMap.keys()),
    };
  }

  private async gradesFromHtml(): Promise<SchoolGrade[]> {
    await this.refreshOauth();
    const paths = ['/przegladaj_oceny/uczen', '/przegladaj_oceny'];
    let parsed: SchoolGrade[] = [];
    let lastHtml = '';
    for (const path of paths) {
      try {
        const html = await this.synergiaText(path);
        lastHtml = html;
        const firstPass = parseGradesHtml(html);
        parsed = combineGrades({ html: [...firstPass, ...parsed] });
        console.warn(
          `[WSGRADES] html ${path} bytes=${html.length} login=${isLoginHtml(html)} denied=${isAccessDeniedHtml(html)} box=${(html.match(/grade-box/gi) ?? []).length} parsed=${firstPass.length} ${htmlPageHint(html)}`,
        );
        if (isAccessDeniedHtml(html) || isLoginHtml(html)) continue;
        if (parsed.length > 0) break;
        const csrf = extractCsrf(html);
        const hidden = extractHiddenInputs(html);
        const headers: Record<string, string> = {
          Accept: 'text/html,application/xhtml+xml',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: `${SYNERGIA}${path}`,
        };
        if (csrf) headers.requestkey = csrf;
        const body = new URLSearchParams({ ...hidden, zmiany_logowanie_wszystkie: '1' });
        const response = await sessionFetch(this.jar, `${SYNERGIA}${path}`, {
          method: 'POST',
          headers,
          body: body.toString(),
        });
        lastHtml = await readResponseText(response);
        const secondPass = parseGradesHtml(lastHtml);
        parsed = combineGrades({ html: [...secondPass, ...parsed] });
        console.warn(
          `[WSGRADES] html POST ${path} bytes=${lastHtml.length} denied=${isAccessDeniedHtml(lastHtml)} parsed=${secondPass.length}`,
        );
        if (parsed.length > 0) break;
      } catch (error) {
        console.warn(
          `[WSGRADES] html ${path} fail ${error instanceof Error ? error.message : String(error)}`,
        );
        logNet(`grades html ${path} fail ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    logNet(`grades html count=${parsed.length} bytes=${lastHtml.length}`);
    return parsed;
  }

  private async fetchGradeDetails(ids: string[]): Promise<SchoolGrade[]> {
    const unique = [...new Set(ids.map(gradeNumericId).filter(Boolean))].slice(0, 30);
    const details = await Promise.all(
      unique.map(async (id) => {
        let retried = false;
        for (const path of [`/przegladaj_oceny/szczegoly/${id}`, `/przegladaj_oceny/szczegoly/1/${id}`]) {
          try {
            let html = await this.synergiaText(path);
            let denied = isAccessDeniedHtml(html);
            console.warn(
              `[WSGRADES] szczegoly ${id} ${path} bytes=${html.length} login=${isLoginHtml(html)} denied=${denied} box=${(html.match(/grade-box/gi) ?? []).length} ${htmlPageHint(html)}`,
            );
            if (denied && !retried) {
              retried = true;
              await this.recoverSession();
              await this.refreshOauth();
              html = await this.synergiaText(path);
              denied = isAccessDeniedHtml(html);
              console.warn(
                `[WSGRADES] szczegoly ${id} retry bytes=${html.length} denied=${denied} ${htmlPageHint(html)}`,
              );
            }
            if (denied) continue;
            const parsed = parseGradeDetailPage(html, id);
            console.warn(`[WSGRADES] szczegoly ${id} ${summarizeGradeDetailHtml(html)}`);
            if (parsed) {
              console.warn(`[WSGRADES] szczegoly ${id} value=${parsed.value} cat=${parsed.category}`);
              logNet(`grades szczegoly ${id} value=${parsed.value} cat=${parsed.category} sub=${parsed.subject}`);
              return parsed;
            }
          } catch (error) {
            console.warn(
              `[WSGRADES] szczegoly ${id} ${path} fail ${error instanceof Error ? error.message : String(error)}`,
            );
            logNet(
              `grades szczegoly ${id} ${path} fail ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        return null;
      }),
    );
    return details.filter((item): item is SchoolGrade => Boolean(item));
  }

  private async wiadomosciReceivers(): Promise<SchoolReceiver[]> {
    const typesPayload = await this.wiadomosciJson(WIADOMOSCI_RECEIVER_TYPE_PATH);
    console.warn(`[WSMSG] types ${summarizeJson(typesPayload)}`);
    const types = parseWiadomosciReceiverTypes(typesPayload);
    const extraClassIds = [
      ...extractReceiverClassIds(typesPayload),
      ...types.flatMap((item) => item.classIds),
    ];
    this.rememberClassIds(extraClassIds);
    console.warn(
      `[WSMSG] types n=${types.length} ids=${types.map((item) => item.id).join(',')} classes=${this.receiverClassIds.join(',') || '-'}`,
    );
    logNet(`wiadomosci receiver types only n=${types.length} classes=${this.receiverClassIds.length}`);
    return [];
  }

  private async sendMessageWiadomosci(
    receiverId: string,
    topic: string,
    body: string,
    typeId?: string,
  ): Promise<boolean> {
    const payloads = [
      { topic, content: body, receiverIds: [receiverId] },
      { topic, content: body, receivers: [{ id: receiverId, type: typeId }] },
    ];
    for (const path of ['/api/outbox/messages', '/api/messages']) {
      for (const payload of payloads) {
        try {
          if (await this.wiadomosciMutate(path, { method: 'POST', body: JSON.stringify(payload) })) {
            logNet(`send wiadomosci ${path} ok`);
            return true;
          }
        } catch {
          // Next payload.
        }
      }
    }
    return false;
  }

  private async ensurePortal(): Promise<void> {
    if (this.portalReady) return;
    if (!this.email || !this.password) {
      throw new KlasowaError('Sesja wygasła. Zaloguj się ponownie.');
    }
    await this.login(this.email, this.password);
  }

  async keepSessionFresh(): Promise<void> {
    if (!this.email || !this.password || this.recovering) return;
    if (Date.now() - this.lastFreshAt < 3 * 60 * 1000) return;
    try {
      await this.refreshOauth();
      this.wiadomosciReady = false;
      this.lastFreshAt = Date.now();
    } catch {
      await this.recoverSession();
    }
  }

  private async recoverSession(): Promise<void> {
    if (this.recovering) return;
    if (!this.email || !this.password) {
      throw new KlasowaError('Sesja w dzienniku wygasła. Zaloguj się ponownie.');
    }
    this.recovering = true;
    const previous = this.child;
    try {
      const list = await this.login(this.email, this.password);
      const match =
        list.find((item) => previous && String(item.id) === String(previous.id)) ??
        list.find((item) => previous && item.login === previous.login) ??
        list[0];
      if (match) {
        this.child = {
          ...match,
          studentName: previous?.studentName || match.studentName,
        };
      }
    } finally {
      this.recovering = false;
    }
  }

  private async recoverSynergiaAccess(): Promise<void> {
    this.portalReady = false;
    this.wiadomosciReady = false;
    await this.recoverSession();
    await this.refreshOauth();
  }

  private async ensureWiadomosci(force = false): Promise<void> {
    if (this.wiadomosciReady && !force) return;
    await this.ensurePortal();
    await this.refreshOauth();
    await this.activateWiadomosciUser();

    // librusek: GET synergia.librus.pl/wiadomosci2 after refreshToken.
    // librus_pyapi: GET synergia.librus.pl/wiadomosci3 (MultiDomainLogon).
    for (const path of ['/wiadomosci2', '/wiadomosci3']) {
      await this.visit(`${SYNERGIA}${path}`);
    }

    this.wiadomosciReady = true;
  }

  private async refreshOauth(): Promise<void> {
    try {
      const response = await sessionFetchFollow(this.jar, `${SYNERGIA}/refreshToken`, {
        method: 'GET',
        headers: { Accept: 'application/json, text/html, */*' },
      });
      const text = await readResponseText(response);
      const fromBody =
        text.match(/oauth_token["']?\s*[:=]\s*["']([^"']+)/i)?.[1] ??
        text.match(/"oauth_token"\s*:\s*"([^"]+)"/)?.[1];
      if (fromBody) {
        this.jar.set('oauth_token', fromBody, 'synergia.librus.pl');
      }
      logNet(
        `refreshToken status=${response.status} oauthCookie=${this.jar.hasName('oauth_token') ? 'yes' : 'no'} bytes=${text.length}`,
      );
    } catch (error) {
      logNet(`refreshToken fail ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async activateWiadomosciUser(): Promise<void> {
    try {
      const info = asRecord(await this.apiJson('/Auth/TokenInfo'));
      const identifier = asString(info.UserIdentifier);
      if (!identifier) return;
      await this.apiJson(`/Auth/UserInfo/${encodeURIComponent(identifier)}`);
    } catch (error) {
      logNet(`userInfo skip ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async bootstrapWiadomosciToken(): Promise<void> {
    try {
      const payload = asRecord(await this.apiJson('/Auth/AutoLoginToken'));
      const nested = asRecord(payload.AutoLoginToken);
      const token = asString(payload.Token) || asString(nested.Token) || asString(nested.token);
      logNet(`autoLoginToken ${token ? `len=${token.length}` : 'empty'} ${summarizeJson(payload)}`);
      if (!token) return;
      await this.visit(`${WIADOMOSCI}/loguj/${encodeURIComponent(token)}`);
    } catch (error) {
      logNet(`autoLoginToken fail ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async visit(url: string): Promise<void> {
    try {
      const response = await sessionFetchFollow(this.jar, url, {
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      const text = await readResponseText(response);
      logNet(`visit ${sanitizeUrl(response.url || url)} status=${response.status} bytes=${text.length}`);
    } catch (error) {
      logNet(`visit fail ${url} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async wiadomosciJson(path: string, attempt = 0): Promise<unknown> {
    await this.ensureWiadomosci();
    const url = `${WIADOMOSCI}${path}`;
    const response = await sessionFetch(this.jar, url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: `${WIADOMOSCI}/nowy/inbox`,
      },
    });
    const text = await readResponseText(response);
    if (text.length > 2_000_000) {
      throw new KlasowaError('Odpowiedź skrzynki jest zbyt duża.', response.status);
    }
    logNet(`inbox ${response.status} ${path} type=${response.headers.get('content-type') ?? 'none'} bytes=${text.length}`);
    console.warn(
      `[WSMSG] ${path} status=${response.status} type=${response.headers.get('content-type') ?? 'none'} bytes=${text.length}`,
    );

    if ((response.status === 401 || response.status === 403) && attempt < 2) {
      this.wiadomosciReady = false;
      if (attempt === 0) {
        await this.refreshOauth();
        await this.bootstrapWiadomosciToken();
        this.jar.copyHost('synergia.librus.pl', 'wiadomosci.librus.pl');
        this.jar.explicitCookies = true;
        await this.visit(`${WIADOMOSCI}/nowy/inbox`);
        await this.ensureWiadomosci(true);
      } else {
        await this.recoverSession();
        await this.ensureWiadomosci(true);
      }
      return this.wiadomosciJson(path, attempt + 1);
    }

    if (!response.ok) {
      throw new KlasowaError(
        response.status === 401 || response.status === 403
          ? 'Nie udało się otworzyć wiadomości. Spróbuj ponownie za chwilę.'
          : 'Nie udało się otworzyć skrzynki. Spróbuj ponownie za chwilę.',
        response.status,
      );
    }

    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new KlasowaError(
        'Skrzynka wiadomości zwróciła nieoczekiwaną odpowiedź. Spróbuj ponownie za chwilę.',
        response.status,
      );
    }
  }

  private async wiadomosciJsonOrNull(path: string): Promise<unknown | null> {
    try {
      return await this.wiadomosciJson(path);
    } catch (error) {
      console.warn(`[WSMSG] ${path} fail ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async wiadomosciMutate(path: string, init: RequestInit): Promise<boolean> {
    await this.ensureWiadomosci();
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json, text/plain, */*');
    headers.set('Referer', `${WIADOMOSCI}/nowy/inbox`);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await sessionFetch(this.jar, `${WIADOMOSCI}${path}`, {
      ...init,
      headers,
    });
    await readResponseText(response);
    if ((response.status === 401 || response.status === 403) && !this.recovering) {
      await this.recoverSession();
      await this.ensureWiadomosci(true);
      const retry = await sessionFetch(this.jar, `${WIADOMOSCI}${path}`, {
        ...init,
        headers,
      });
      await readResponseText(retry);
      logNet(`inbox mutate retry ${retry.status} ${init.method ?? 'GET'} ${path}`);
      return retry.ok;
    }
    logNet(`inbox mutate ${response.status} ${init.method ?? 'GET'} ${path}`);
    return response.ok;
  }

  private async hideHtmlMessage(
    folderId: string,
    messageId: string,
    action: 'archived' | 'deleted',
  ): Promise<boolean> {
    const forms: Record<string, string>[] =
      action === 'deleted'
        ? [
            { usun: '1', 'wiadomosci[]': messageId, poprzednia: folderId },
            { 'usunWiadomosci[]': messageId, poprzednia: folderId },
          ]
        : [{ archiwizuj: '1', 'wiadomosci[]': messageId, poprzednia: folderId }];

    for (const fields of forms) {
      try {
        const response = await sessionFetch(this.jar, `${SYNERGIA}/wiadomosci`, {
          method: 'POST',
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${SYNERGIA}/wiadomosci/${folderId}`,
          },
          body: new URLSearchParams(fields).toString(),
        });
        await readResponseText(response);
        if (response.ok) return true;
      } catch {
        // Next form variant.
      }
    }
    return false;
  }

  private async refreshChildToken(): Promise<void> {
    this.portalReady = false;
    await this.ensurePortal();
  }

  private async scrapeInbox(): Promise<SchoolMessage[]> {
    const collected: SchoolMessage[] = [];
    let lastError: unknown;
    for (const folder of ['5', '']) {
      const path = folder ? `/wiadomosci/${folder}` : '/wiadomosci';
      try {
        collected.push(...parseInboxHtml(await this.synergiaText(path)));
      } catch (error) {
        lastError = error;
      }
    }
    if (collected.length === 0 && lastError) throw lastError;
    const seen = new Set<string>();
    return collected.filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  private async scrapeSent(): Promise<SchoolMessage[]> {
    return parseInboxHtml(await this.synergiaText('/wiadomosci/6'), 'sent');
  }

  private async extraSchoolClassIds(): Promise<string[]> {
    const ids = new Set<string>();
    try {
      for (const id of classIdsFromMe(await this.apiJson('/Me'))) ids.add(id);
    } catch {
      // Ignore.
    }
    if (ids.size === 0) {
      try {
        for (const item of jsonList(await this.apiJson('/Classes'), ['Classes'])) {
          const id = refId(item);
          if (/^\d{1,8}$/.test(id) && id !== '0') ids.add(id);
        }
      } catch {
        // Parent accounts often cannot list every class.
      }
    }
    console.warn(`[WSMSG] extra class ids=${[...ids].join(',') || '-'}`);
    return [...ids];
  }

  private async postGetRecipients(
    typeId: string,
    classId: string,
    csrf: string | null,
    refererPath: string,
  ): Promise<{ ok: boolean; text: string }> {
    const form = new URLSearchParams({
      poprzednia: '5',
      tabZaznaczonych: '',
      czyWirtualneKlasy: 'false',
      idGrupy: '0',
    });
    applyRecipientClassFields(form, typeId, classId);
    if (classId && canonicalRecipientTypeId(typeId) === 'nauczyciel') form.set('nauczyciele', classId);
    const headers: Record<string, string> = {
      Accept: 'text/html,application/xhtml+xml,application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${SYNERGIA}${refererPath}`,
    };
    if (csrf) {
      headers.requestkey = csrf;
      form.set('requestkey', csrf);
    }
    const response = await sessionFetch(this.jar, `${SYNERGIA}/getRecipients`, {
      method: 'POST',
      headers,
      body: form.toString(),
    });
    return { ok: response.ok, text: await readResponseText(response) };
  }

  private async fetchRecipientGroup(
    typeId: string,
    typeLabel: string,
    csrf: string | null,
    refererPath: string,
    classId = '',
  ): Promise<SchoolReceiver[]> {
    try {
      let csrfKey = csrf;
      let { ok, text } = await this.postGetRecipients(typeId, classId, csrfKey, refererPath);
      if (!ok || isAccessDeniedHtml(text) || isLoginHtml(text)) {
        console.warn(`[WSMSG] ${typeId} denied, recovering bytes=${text.length}`);
        await this.recoverSynergiaAccess();
        const page = await this.synergiaText(refererPath);
        csrfKey = extractCsrf(page);
        if (this.receiverContext) this.receiverContext.csrf = csrfKey;
        ({ ok, text } = await this.postGetRecipients(typeId, classId, csrfKey, refererPath));
      }
      if (!ok) {
        console.warn(`[WSMSG] ${typeId} http fail bytes=${text.length} ${htmlPageHint(text)}`);
        return [];
      }
      this.rememberClassIds(this.classIdsFromRecipientResponse(text));
      let body = text;
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const payload = JSON.parse(trimmed) as unknown;
          const raw = asRecord(payload);
          if (typeof raw.html === 'string') body = raw.html;
          else if (typeof raw.data === 'string') body = raw.data;
          const fromHtml = parseRecipientsHtml(body, typeLabel, typeId);
          if (fromHtml.length > 0) return fromHtml;
          const fromJson = uniqueReceivers([
            ...parseReceivers(payload, typeLabel, typeId),
            ...parseWiadomosciReceiverCatalog(payload).map((item) => ({
              ...item,
              group: item.group || typeLabel,
              typeId: item.typeId || typeId,
            })),
          ]);
          if (fromJson.length > 0) return fromJson;
        } catch {
          // Fall through to HTML parse of the raw body.
        }
      }
      const people = parseRecipientsHtml(body, typeLabel, typeId);
      if (people.length === 0) {
        console.warn(`[WSMSG] ${typeId} empty bytes=${text.length} ${htmlPageHint(text)}`);
      }
      return people;
    } catch {
      return [];
    }
  }

  private async sendMessageHtml(
    receiverId: string,
    topic: string,
    body: string,
    replyToId?: string,
    receiverTypeId?: string,
  ): Promise<boolean> {
    for (let round = 0; round < 2; round += 1) {
      if (round > 0) await this.recoverSynergiaAccess();
      const sent = await this.postComposeMessage(receiverId, topic, body, replyToId, receiverTypeId);
      if (sent === 'ok') return true;
      if (sent !== 'denied') return false;
    }
    return false;
  }

  private async postComposeMessage(
    receiverId: string,
    topic: string,
    body: string,
    replyToId?: string,
    receiverTypeId?: string,
  ): Promise<'ok' | 'denied' | 'rejected' | 'unknown'> {
    const messageId = replyToId?.match(/(\d+)$/)?.[1];
    const composePaths = messageId
      ? [`/wiadomosci/3/5/${messageId}`, `/wiadomosci/2/5/${messageId}`, '/wiadomosci/2/5']
      : ['/wiadomosci/2/5'];

    let composeHtml = '';
    let composePath = composePaths[0] ?? '/wiadomosci/2/5';
    for (const path of composePaths) {
      try {
        const html = await this.synergiaText(path);
        if (isLoginHtml(html) || isAccessDeniedHtml(html)) continue;
        if (/name=["'](?:DoKogo|temat|tresc)/i.test(html)) {
          composeHtml = html;
          composePath = path;
          break;
        }
        if (!composeHtml && /csrfTokenValue|requestkey/i.test(html)) {
          composeHtml = html;
          composePath = path;
        }
      } catch {
        // Try the next compose URL.
      }
    }
    if (!composeHtml || isAccessDeniedHtml(composeHtml) || isLoginHtml(composeHtml)) {
      return 'denied';
    }

    const csrf = extractCsrf(composeHtml);
    const hidden = extractHiddenInputs(composeHtml);
    const official = replyToId ? extractReplyAddressee(composeHtml) : { id: '', name: '' };
    let senderName = official.name || '';
    if (replyToId && !senderName) {
      try {
        senderName = (await this.getMessage(replyToId)).sender;
      } catch {
        // Fall back to the id selected in the app.
      }
    }

    const wantedId = plausibleReceiverId(receiverId);
    let matched: SchoolReceiver | undefined;
    if (this.receiversCache.length > 0 && (senderName || wantedId)) {
      matched =
        this.receiversCache.find((item) => wantedId && item.id === wantedId) ??
        this.receiversCache.find((item) => namesMatch(item.name, senderName));
    }

    const targetId =
      plausibleReceiverId(matched?.id) ||
      wantedId ||
      plausibleReceiverId(official.id) ||
      plausibleReceiverId(hidden.DoKogo);
    if (!targetId) {
      throw new KlasowaError('Nie udało się ustalić odbiorcy. Wybierz osobę z listy.');
    }

    const typeId = receiverTypeId || recipientTypeId(matched?.group, matched?.typeId);
    const classId = recipientNeedsClass(typeId)
      ? this.receiverClassIds[0] || parseRecipientClassIds(composeHtml)[0] || ''
      : '';
    if (classId) this.rememberClassIds([classId]);

    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(hidden)) {
      if (/^DoKogo/i.test(name) || name === 'wyslij') continue;
      form.set(name, value);
    }
    form.set('filtrUzytkownikow', form.get('filtrUzytkownikow') || '0');
    form.set('idPojemnika', form.get('idPojemnika') || '');
    form.set('Rodzaj', form.get('Rodzaj') || '0');
    form.set('poprzednia', form.get('poprzednia') || '5');
    form.set('fileStorageIdentifier', form.get('fileStorageIdentifier') || '');
    form.set('temat', topic);
    form.set('tresc', body);
    form.set('wyslij', 'Wyślij');
    form.append('DoKogo[]', targetId);
    applyRecipientClassFields(form, typeId, classId);
    if (csrf) form.set('requestkey', csrf);
    const originalId = plausibleReceiverId(hidden.idWiadomosciOrg) || plausibleReceiverId(hidden.Wid) || messageId;
    if (replyToId && originalId) {
      form.set('Wid', hidden.Wid || originalId);
      form.set('idWiadomosciOrg', hidden.idWiadomosciOrg || originalId);
    }

    console.warn(
      `[WSMSG] send html compose=${composePath} csrf=${csrf ? 'yes' : 'no'} type=${typeId} idLen=${targetId.length} source=${matched ? 'list' : 'form'}`,
    );

    const headers: Record<string, string> = {
      Accept: 'text/html,application/xhtml+xml',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${SYNERGIA}${composePath}`,
    };
    if (csrf) headers.requestkey = csrf;

    const posted = await this.postMessageForm(`${SYNERGIA}/wiadomosci/5`, headers, form);
    if (posted === 'ok' || posted === 'rejected' || posted === 'denied') return posted;

    const alt = new URLSearchParams(form);
    alt.delete('DoKogo[]');
    alt.set('DoKogo', targetId);
    return this.postMessageForm(`${SYNERGIA}/wiadomosci/5`, headers, alt);
  }

  private async postMessageForm(
    url: string,
    headers: Record<string, string>,
    form: URLSearchParams,
  ): Promise<'ok' | 'denied' | 'rejected' | 'unknown'> {
    const response = await sessionFetch(this.jar, url, {
      method: 'POST',
      headers,
      body: form.toString(),
    });
    const html = await readResponseText(response);
    if (isAccessDeniedHtml(html) || isLoginHtml(html)) {
      console.warn(`[WSMSG] send html denied status=${response.status} bytes=${html.length}`);
      return 'denied';
    }
    const result = parseSendResult(html);
    console.warn(
      `[WSMSG] send html status=${response.status} ok=${result.ok} hint=${result.hint.replace(/\s+/g, ' ').slice(0, 160)}`,
    );
    if (result.ok) return 'ok';
    if (result.hint) throw new KlasowaError(result.hint, response.status);
    return response.ok ? 'unknown' : 'rejected';
  }

  private async synergiaText(path: string): Promise<string> {
    const url = `${SYNERGIA}${path}`;
    const response = await sessionFetch(this.jar, url, {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    const html = await readResponseText(response);
    const expired =
      isLoginHtml(html) ||
      isAccessDeniedHtml(html) ||
      response.status === 401 ||
      response.status === 403;

    if (expired) {
      await this.recoverSynergiaAccess();
      const retry = await sessionFetch(this.jar, url, {
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      const retryHtml = await readResponseText(retry);
      if (isLoginHtml(retryHtml) || retry.status === 401 || retry.status === 403 || !retry.ok) {
        throw new KlasowaError('Nie udało się otworzyć wiadomości. Spróbuj ponownie za chwilę.', retry.status);
      }
      return retryHtml;
    }

    if (!response.ok) {
      throw new KlasowaError('Nie udało się otworzyć dziennika.', response.status);
    }
    return html;
  }

  private async apiJson(path: string, attempt = 0): Promise<unknown> {
    const url = `${this.apiRoot}${path}`;
    const token = this.child?.accessToken;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers.Origin = 'app://librus';
    }

    const response = await sessionFetch(this.jar, url, {
      method: 'GET',
      headers,
    });

    if (response.status === 401 && attempt < 2) {
      if (attempt === 0) await this.refreshChildToken();
      else await this.recoverSession();
      return this.apiJson(path, attempt + 1);
    }

    if (!response.ok) {
      throw new KlasowaError(apiErrorMessage(response.status, path), response.status);
    }

    return readJson(response, url);
  }

  private async apiSend(path: string, body: unknown): Promise<Response> {
    const url = `${this.apiRoot}${path}`;
    const token = this.child?.accessToken;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers.Origin = 'app://librus';
    }
    return sessionFetch(this.jar, url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }
}

function nameFromMe(payload: unknown): string {
  const root = asRecord(payload);
  const me = asRecord(root.Me);
  const user = asRecord(me.User ?? me.Account ?? root.User);
  return (
    fullName(asString(user.FirstName), asString(user.LastName)) ||
    asString(user.Name) ||
    'Konto rodzica'
  );
}

function apiErrorMessage(status: number, path: string): string {
  if (status === 403 && path.startsWith('/Messages')) {
    return 'Librus nie udostępnił skrzynki wiadomości dla tego tokenu.';
  }
  if (status === 403) return 'Brak dostępu do tej części dziennika.';
  if (status === 401) return 'Nie udało się pobrać danych. Spróbuj ponownie za chwilę.';
  if (status >= 500) return 'Serwery Librusa mają przerwę. Spróbuj za chwilę.';
  return 'Nie udało się pobrać danych z dziennika.';
}

function normalizeMessageId(id: string | string[]): string {
  const raw = Array.isArray(id) ? id[0] : id;
  if (!raw) return '';
  try {
    return decodeURIComponent(String(raw)).trim();
  } catch {
    return String(raw).trim();
  }
}

function mergeMessages(primary: SchoolMessage, fallback?: SchoolMessage): SchoolMessage {
  if (!fallback) {
    return { ...primary, sender: primary.sender || 'Szkoła' };
  }
  const primaryBody = primary.body?.trim() ?? '';
  const fallbackBody = fallback.body?.trim() ?? '';
  return {
    ...fallback,
    ...primary,
    id: fallback.id || primary.id,
    kind: fallback.kind || primary.kind,
    body: primaryBody.length >= fallbackBody.length ? primary.body : fallback.body,
    topic:
      primary.topic && primary.topic !== '(bez tematu)' ? primary.topic : fallback.topic || primary.topic,
    sender:
      primary.sender && primary.sender !== 'Szkoła' ? primary.sender : fallback.sender || primary.sender || 'Szkoła',
    senderId: primary.senderId || fallback.senderId,
    hasAttachments: primary.hasAttachments || fallback.hasAttachments,
  };
}

function uniqueReceivers(receivers: SchoolReceiver[]): SchoolReceiver[] {
  const byKey = new Map<string, SchoolReceiver>();
  for (const receiver of receivers) {
    if (!receiver.id) continue;
    const key = `${receiver.id}::${receiver.group ?? ''}`;
    const existing = byKey.get(key);
    if (!existing || groupRank(receiver.group) < groupRank(existing.group)) {
      byKey.set(key, receiver);
    }
  }
  return [...byKey.values()];
}

function groupRank(group?: string): number {
  const order = [
    'Wychowawcy',
    'Rodzice',
    'Opiekunowie',
    'Rady klasowe rodziców',
    'Szkolna rada rodziców',
    'Psychologowie',
    'Pedagodzy',
    'Logopedzi',
    'Pracownik biblioteki',
    'Biblioteka',
    'Sekretariat',
    'Administrator Szkoły',
    'Grupa adresatów',
    'Nauczyciele',
  ];
  const index = order.indexOf(group ?? '');
  return index === -1 ? 80 : index;
}

function oauthNextUrl(value: string): string {
  const url = new URL(value, `${AUTH}/`);
  if (url.protocol !== 'https:' || url.hostname !== 'api.librus.pl' || !url.pathname.startsWith('/OAuth/Authorization')) {
    throw new KlasowaError('Nieoczekiwany adres po logowaniu.');
  }
  return url.toString();
}

function createBanerHeader(): string {
  const timestampPart = encodeBanerSegment(Date.now().toString());
  const randomPart = encodeBanerSegment(Math.random().toString());
  return `${randomPart}_${timestampPart}`;
}

function encodeBanerSegment(value: string): string {
  return value
    .split('')
    .map((letter) => String.fromCharCode(letter.charCodeAt(0) + 20))
    .join('');
}
