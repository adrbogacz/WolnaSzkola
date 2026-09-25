import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Alert, AppState } from 'react-native';

import { DEFAULT_APP_SETTINGS, type HideStatus } from '@/src/appSettings';
import { ensureNotificationPermission } from '@/src/background/notifications';
import { applySyncInterval } from '@/src/background/syncTask';
import { LibrusClient } from '@/src/librus/client';
import {
  DEMO_ANNOUNCEMENTS,
  DEMO_ATTENDANCE,
  DEMO_CHILD,
  DEMO_GRADES,
  DEMO_MESSAGES,
  DEMO_RECEIVERS,
  DEMO_SENT,
  demoTimetable,
} from '@/src/librus/demo';
import { KlasowaError } from '@/src/librus/errors';
import { CORE_RECIPIENT_TYPES } from '@/src/librus/scrape';
import type {
  ChildAccount,
  SchoolAttendance,
  SchoolDayPlan,
  SchoolGrade,
  SchoolMessage,
  SchoolReceiver,
  SchoolReceiverGroup,
} from '@/src/librus/types';
import {
  clearLocalOverlays,
  clearSession,
  loadAccounts,
  loadAppSettings,
  loadHideState,
  loadReadState,
  loadSession,
  saveAccountLabel,
  saveAccounts,
  saveAppSettings,
  saveChild,
  saveCredentials,
  saveHideState,
  saveReadState,
} from '@/src/storage';

export type SessionStatus = 'booting' | 'loggedOut' | 'selectChild' | 'ready';

type FetchOptions = { force?: boolean };

type SchoolApi = {
  getMessages: (options?: FetchOptions) => Promise<SchoolMessage[]>;
  peekMessages: () => Promise<SchoolMessage[] | null>;
  getSentMessages: (options?: FetchOptions) => Promise<SchoolMessage[]>;
  peekSentMessages: () => Promise<SchoolMessage[] | null>;
  getAnnouncements: (options?: FetchOptions) => Promise<SchoolMessage[]>;
  peekAnnouncements: () => Promise<SchoolMessage[] | null>;
  getMessage: (id: string, options?: FetchOptions) => Promise<SchoolMessage>;
  markServerRead: (id: string) => Promise<void>;
  hideOnServer: (id: string, action: HideStatus) => Promise<void>;
  listReceivers: (options?: FetchOptions) => Promise<SchoolReceiver[]>;
  peekReceivers: () => Promise<SchoolReceiver[] | null>;
  listReceiverGroups: (options?: FetchOptions) => Promise<SchoolReceiverGroup[]>;
  peekReceiverGroups: () => Promise<SchoolReceiverGroup[]>;
  listReceiversForGroup: (typeId: string, options?: FetchOptions) => Promise<SchoolReceiver[]>;
  peekReceiversForGroup: (typeId: string) => Promise<SchoolReceiver[] | null>;
  getReplyAddressee: (messageId: string) => Promise<{ id: string; name: string } | null>;
  sendMessage: (input: {
    receiverId: string;
    topic: string;
    body: string;
    replyToId?: string;
    receiverTypeId?: string;
  }) => Promise<void>;
  getGrades: () => Promise<SchoolGrade[]>;
  getAttendance: () => Promise<SchoolAttendance[]>;
  getTimetable: (weekStart: string) => Promise<SchoolDayPlan[]>;
};

export type AccountSummary = {
  id: string;
  login: string;
  label: string;
};

type AuthContextValue = {
  status: SessionStatus;
  isDemo: boolean;
  accounts: AccountSummary[];
  accountId: string | null;
  children: ChildAccount[];
  child: ChildAccount | null;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  enterDemo: () => void;
  selectChild: (child: ChildAccount) => Promise<void>;
  switchAccount: (accountId: string) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  logout: () => Promise<void>;
  api: SchoolApi;
  isItemRead: (id: string, fallback: boolean) => boolean;
  setItemRead: (id: string, read: boolean) => void;
  hideStatus: (id: string) => HideStatus | undefined;
  hideItem: (id: string, action: HideStatus) => Promise<void>;
  showArchived: boolean;
  setShowArchived: (value: boolean) => void;
  syncIntervalMinutes: number;
  setSyncIntervalMinutes: (minutes: number) => Promise<void>;
  clearLocalAppData: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function demoReceiverGroups(): SchoolReceiverGroup[] {
  return CORE_RECIPIENT_TYPES.map((item) => ({ id: item.id, label: item.label }));
}

const demoApi: SchoolApi = {
  getMessages: async () => DEMO_MESSAGES,
  peekMessages: async () => DEMO_MESSAGES,
  getSentMessages: async () => DEMO_SENT,
  peekSentMessages: async () => DEMO_SENT,
  getAnnouncements: async () => DEMO_ANNOUNCEMENTS,
  peekAnnouncements: async () => DEMO_ANNOUNCEMENTS,
  getMessage: async (id) => {
    const found =
      DEMO_MESSAGES.find((message) => message.id === id) ??
      DEMO_SENT.find((message) => message.id === id) ??
      DEMO_ANNOUNCEMENTS.find((message) => message.id === id);
    if (!found) throw new KlasowaError('Nie znaleziono wiadomości.');
    return found;
  },
  markServerRead: async () => undefined,
  hideOnServer: async () => undefined,
  listReceivers: async () => DEMO_RECEIVERS,
  peekReceivers: async () => DEMO_RECEIVERS,
  listReceiverGroups: async () => demoReceiverGroups(),
  peekReceiverGroups: async () => demoReceiverGroups(),
  listReceiversForGroup: async (typeId) => DEMO_RECEIVERS.filter((item) => item.typeId === typeId),
  peekReceiversForGroup: async (typeId) => DEMO_RECEIVERS.filter((item) => item.typeId === typeId),
  getReplyAddressee: async (id) => {
    const found = DEMO_MESSAGES.find((message) => message.id === id);
    if (!found?.senderId) return null;
    return { id: found.senderId, name: found.sender };
  },
  sendMessage: async () => undefined,
  getGrades: async () => DEMO_GRADES,
  getAttendance: async () => DEMO_ATTENDANCE,
  getTimetable: async (weekStart) => demoTimetable(weekStart),
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('booting');
  const [isDemo, setIsDemo] = useState(false);
  const [client] = useState(() => new LibrusClient());
  const [accountList, setAccountList] = useState<AccountSummary[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [childList, setChildList] = useState<ChildAccount[]>([]);
  const [child, setChild] = useState<ChildAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readState, setReadState] = useState<Record<string, boolean>>({});
  const [hideState, setHideState] = useState<Record<string, HideStatus>>({});
  const [showArchived, setShowArchivedState] = useState(DEFAULT_APP_SETTINGS.showArchived);
  const [syncIntervalMinutes, setSyncIntervalState] = useState(DEFAULT_APP_SETTINGS.syncIntervalMinutes);

  const rememberAccounts = useCallback(async () => {
    const stored = await loadAccounts();
    setAccountList(stored.accounts.map((account) => ({ id: account.id, login: account.login, label: account.label })));
    setAccountId(stored.activeId);
    return stored;
  }, []);

  const finishWithChildren = useCallback(async (
    list: ChildAccount[],
    preferred?: { id?: string; login?: string },
    activeId?: string | null,
  ) => {
    setChildList(list);
    const match =
      list.find((item) => preferred?.id && String(item.id) === preferred.id) ??
      list.find((item) => preferred?.login && item.login === preferred.login);
    const chosen = match ?? (list.length === 1 ? list[0] : null);

    if (chosen) {
      await client.selectChild(chosen);
      await saveChild(String(chosen.id), chosen.login);
      if (chosen.studentName && activeId) await saveAccountLabel(activeId, chosen.studentName);
      setChild(chosen);
      setSessionKey((value) => value + 1);
      setStatus('ready');
      await rememberAccounts();
      return;
    }

    setStatus('selectChild');
  }, [client, rememberAccounts]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [stored, settings] = await Promise.all([loadSession(), loadAppSettings()]);
        if (cancelled) return;
        setShowArchivedState(settings.showArchived);
        setSyncIntervalState(settings.syncIntervalMinutes);

        const storedAccounts = await rememberAccounts();
        if (!stored) {
          setStatus('loggedOut');
          await applySyncInterval(0);
          return;
        }
        const list = await client.login(stored.email, stored.password);
        if (cancelled) return;
        await finishWithChildren(list, { id: stored.childId, login: stored.childLogin }, stored.accountId);
        if (storedAccounts.accounts.length === 0) await rememberAccounts();
        await applySyncInterval(settings.syncIntervalMinutes);
      } catch {
        if (!cancelled) {
          client.resetSession();
          await applySyncInterval(0);
          setStatus('loggedOut');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, finishWithChildren, rememberAccounts]);

  useEffect(() => {
    if (status !== 'ready' || isDemo) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void client.keepSessionFresh();
    });
    return () => sub.remove();
  }, [client, isDemo, status]);

  useEffect(() => {
    if (!accountId || isDemo) return;
    let cancelled = false;
    void Promise.all([loadReadState(accountId), loadHideState(accountId)]).then(([read, hide]) => {
      if (cancelled) return;
      setReadState(read);
      setHideState(hide);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, isDemo]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const list = await client.login(email, password);
      const id = await saveCredentials(email.trim(), password, list[0]?.studentName);
      setAccountId(id);
      setIsDemo(false);
      await finishWithChildren(list, undefined, id);
      const settings = await loadAppSettings();
      await applySyncInterval(settings.syncIntervalMinutes);
    },
    [client, finishWithChildren],
  );

  const enterDemo = useCallback(() => {
    setIsDemo(true);
    setChildList([DEMO_CHILD]);
    setChild(DEMO_CHILD);
    setError(null);
    setStatus('ready');
  }, []);

  const selectChildAccount = useCallback(
    async (next: ChildAccount) => {
      if (isDemo) {
        setChild(next);
        setStatus('ready');
        return;
      }
      await client.selectChild(next);
      await saveChild(String(next.id), next.login);
      setChild(next);
      setSessionKey((value) => value + 1);
      setStatus('ready');
    },
    [client, isDemo],
  );

  const switchAccount = useCallback(
    async (nextId: string) => {
      const stored = await loadAccounts();
      const account = stored.accounts.find((item) => item.id === nextId);
      if (!account) return;
      await saveAccounts(stored.accounts, account.id);
      setAccountId(account.id);
      setIsDemo(false);
      const list = await client.login(account.login, account.password);
      await finishWithChildren(list, { id: account.childId, login: account.childLogin }, account.id);
    },
    [client, finishWithChildren],
  );

  const removeAccount = useCallback(
    async (targetId: string) => {
      const stored = await loadAccounts();
      const remaining = stored.accounts.filter((item) => item.id !== targetId);
      if (remaining.length === 0) {
        client.resetSession();
        await clearSession();
        await applySyncInterval(0);
        setIsDemo(false);
        setAccountList([]);
        setAccountId(null);
        setChild(null);
        setChildList([]);
        setError(null);
        setStatus('loggedOut');
        return;
      }
      const nextActive = stored.activeId === targetId ? remaining[0]?.id ?? null : stored.activeId;
      await saveAccounts(remaining, nextActive);
      if (stored.activeId === targetId && nextActive) {
        const account = remaining.find((item) => item.id === nextActive);
        if (!account) return;
        setAccountId(account.id);
        const list = await client.login(account.login, account.password);
        await finishWithChildren(list, { id: account.childId, login: account.childLogin }, account.id);
        return;
      }
      await rememberAccounts();
    },
    [client, finishWithChildren, rememberAccounts],
  );

  const logout = useCallback(async () => {
    if (accountId) {
      await removeAccount(accountId);
      return;
    }
    client.resetSession();
    await clearSession();
    await applySyncInterval(0);
    setIsDemo(false);
    setAccountList([]);
    setAccountId(null);
    setChild(null);
    setChildList([]);
    setError(null);
    setStatus('loggedOut');
  }, [accountId, client, removeAccount]);

  const isItemRead = useCallback(
    (id: string, fallback: boolean) =>
      Object.prototype.hasOwnProperty.call(readState, id) ? Boolean(readState[id]) : fallback,
    [readState],
  );

  const setItemRead = useCallback((id: string, read: boolean) => {
    setReadState((previous) => {
      const next = { ...previous, [id]: read };
      void saveReadState(next, accountId ?? '');
      return next;
    });
  }, [accountId]);

  const hideStatusFor = useCallback(
    (id: string) => hideState[id],
    [hideState],
  );

  const hideItem = useCallback(
    async (id: string, action: HideStatus) => {
      const localOnly = isDemo || id.startsWith('a-');
      let serverFailed = false;
      if (!localOnly) {
        try {
          await client.hideOnServer(id, action);
        } catch {
          serverFailed = true;
        }
      }

      setHideState((previous) => {
        const next = { ...previous, [id]: action };
        void saveHideState(next, accountId ?? '');
        return next;
      });

      if (id.startsWith('a-') && action === 'deleted') {
        Alert.alert('Ukryte', 'Ukryte w tej apce; w dzienniku nadal jest');
      } else if (serverFailed) {
        Alert.alert('Zapisane lokalnie', 'Dziennik nie przyjął zmiany. Pozycja zostaje ukryta w tej apce.');
      }
    },
    [accountId, client, isDemo],
  );

  const setShowArchived = useCallback((value: boolean) => {
    setShowArchivedState(value);
    void saveAppSettings({ showArchived: value, syncIntervalMinutes });
  }, [syncIntervalMinutes]);

  const setSyncIntervalMinutes = useCallback(async (minutes: number) => {
    if (minutes > 0) {
      const allowed = await ensureNotificationPermission();
      if (!allowed) {
        Alert.alert(
          'Powiadomienia',
          'Bez zgody apka nadal odświeży skrzynkę w tle, ale nie pokaże powiadomienia o nowej poczcie.',
        );
      }
    }
    setSyncIntervalState(minutes);
    await saveAppSettings({ showArchived, syncIntervalMinutes: minutes });
    if (status === 'ready' && !isDemo) {
      await applySyncInterval(minutes);
    } else {
      await applySyncInterval(0);
    }
  }, [isDemo, showArchived, status]);

  const clearLocalAppData = useCallback(async () => {
    await clearLocalOverlays(accountId ?? '');
    setReadState({});
    setHideState({});
  }, [accountId]);

  const api = useMemo<SchoolApi>(() => {
    if (isDemo) return demoApi;
    return {
      getMessages: (options) => client.getMessages(options),
      peekMessages: () => client.peekMessages(),
      getSentMessages: (options) => client.getSentMessages(options),
      peekSentMessages: () => client.peekSentMessages(),
      getAnnouncements: (options) => client.getAnnouncements(options),
      peekAnnouncements: () => client.peekAnnouncements(),
      getMessage: (id, options) => client.getMessage(id, options),
      markServerRead: (id) => client.markServerRead(id),
      hideOnServer: (id, action) => client.hideOnServer(id, action),
      listReceivers: (options) => client.listReceivers(options),
      peekReceivers: () => client.peekReceivers(),
      listReceiverGroups: (options) => client.listReceiverGroups(options),
      peekReceiverGroups: () => client.peekReceiverGroups(),
      listReceiversForGroup: (typeId, options) => client.listReceiversForGroup(typeId, options),
      peekReceiversForGroup: (typeId) => client.peekReceiversForGroup(typeId),
      getReplyAddressee: (id) => client.resolveReplyAddressee(id),
      sendMessage: (input) => client.sendMessage(input),
      getGrades: () => client.getGrades(),
      getAttendance: () => client.getAttendance(),
      getTimetable: (weekStart) => client.getTimetable(weekStart),
    };
  }, [client, isDemo, sessionKey]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      isDemo,
      accounts: accountList,
      accountId,
      children: childList,
      child,
      error,
      login,
      enterDemo,
      selectChild: selectChildAccount,
      switchAccount,
      removeAccount,
      logout,
      api,
      isItemRead,
      setItemRead,
      hideStatus: hideStatusFor,
      hideItem,
      showArchived,
      setShowArchived,
      syncIntervalMinutes,
      setSyncIntervalMinutes,
      clearLocalAppData,
    }),
    [
      status,
      isDemo,
      accountList,
      accountId,
      childList,
      child,
      error,
      login,
      enterDemo,
      selectChildAccount,
      switchAccount,
      removeAccount,
      logout,
      api,
      isItemRead,
      setItemRead,
      hideStatusFor,
      hideItem,
      showArchived,
      setShowArchived,
      syncIntervalMinutes,
      setSyncIntervalMinutes,
      clearLocalAppData,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
