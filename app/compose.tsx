import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/src/auth/AuthContext';
import { listContentStyle } from '@/src/format';
import { messageFromUnknown } from '@/src/librus/errors';
import { useSchoolQuery } from '@/src/hooks/useSchoolQuery';
import type { SchoolReceiver, SchoolReceiverGroup } from '@/src/librus/types';
import { looksLikePersonName, namesMatch, quotedReply, replyTopic } from '@/src/reply';
import { plausibleReceiverId } from '@/src/librus/scrape';
import { Card, LoadingState, PrimaryButton, ScreenMessage, useTheme } from '@/src/ui';

const GROUP_ORDER: string[] = [
  'Wychowawcy',
  'Rodzice',
  'Opiekunowie',
  'Rady klasowe rodziców',
  'Szkolna rada rodziców',
  'Nauczyciele',
  'Psychologowie',
  'Pedagodzy',
  'Logopedzi',
  'Pracownik biblioteki',
  'Biblioteka',
  'Sekretariat',
  'Administrator Szkoły',
  'Grupa adresatów',
];

export default function ComposeScreen() {
  const params = useLocalSearchParams<{
    receiverId?: string;
    receiverName?: string;
    topic?: string;
    replyToId?: string;
  }>();
  const { status, api, isDemo } = useAuth();
  const theme = useTheme();
  const groupsQuery = useSchoolQuery(
    (force) => api.listReceiverGroups({ force }),
    [api],
    () => api.peekReceiverGroups(),
  );
  const catalog = groupsQuery.data ?? [];
  const [peopleByType, setPeopleByType] = useState<Record<string, SchoolReceiver[]>>({});
  const [loadingType, setLoadingType] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const inflightRef = useRef(new Set<string>());
  const [receiverId, setReceiverId] = useState(params.replyToId ? '' : (params.receiverId ?? ''));
  const [replyName, setReplyName] = useState(params.receiverName ?? '');
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState(params.topic ?? '');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Wychowawcy: true });
  const [activeGroup, setActiveGroup] = useState<string | null>('Wychowawcy');
  const receivers = useMemo(() => Object.values(peopleByType).flat(), [peopleByType]);
  const groupTitles = useMemo(
    () =>
      [...GROUP_ORDER.filter((title) => catalog.some((item) => item.label === title)),
        ...catalog.map((item) => item.label).filter((title) => !GROUP_ORDER.includes(title)),
      ],
    [catalog],
  );
  const searching = Boolean(query.trim());
  const groups = useMemo(
    () => visibleGroups(catalog, peopleByType, query, searching ? null : activeGroup),
    [activeGroup, catalog, peopleByType, query, searching],
  );

  async function loadType(typeId: string, force = false) {
    if (!typeId) return;
    if (!force && (peopleByType[typeId]?.length ?? 0) > 0) return;
    if (!force && inflightRef.current.has(typeId)) return;
    inflightRef.current.add(typeId);
    setLoadingType(typeId);
    setGroupError(null);
    try {
      const people = await api.listReceiversForGroup(typeId, { force });
      setPeopleByType((current) => ({ ...current, [typeId]: people }));
    } catch (caught) {
      setGroupError(messageFromUnknown(caught));
    } finally {
      inflightRef.current.delete(typeId);
      setLoadingType(null);
    }
  }

  useEffect(() => {
    const tutor = catalog.find((item) => item.id === 'wychowawca');
    if (tutor) void loadType(tutor.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, catalog]);

  useEffect(() => {
    if (!params.receiverName && !params.replyToId) return;
    const matched = matchReceiver(receivers, params.receiverId, params.receiverName || replyName);
    if (matched) return;
    const teacher = catalog.find((item) => item.id === 'nauczyciel');
    if (teacher) void loadType(teacher.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, catalog, params.receiverId, params.receiverName, params.replyToId, receivers, replyName]);

  useEffect(() => {
    if (params.replyToId) return;
    const matched = matchReceiver(receivers, params.receiverId, params.receiverName);
    if (!matched) return;
    setReceiverId((current) => current || matched.id);
    const title = matched.group?.trim() || 'Inni';
    setOpenGroups((current) => (current[title] ? current : { ...current, [title]: true }));
  }, [params.receiverId, params.receiverName, params.replyToId, receivers]);

  useEffect(() => {
    const replyToId = params.replyToId;
    if (!replyToId) return;
    let cancelled = false;
    void (async () => {
      const [addressee, message] = await Promise.all([
        api.getReplyAddressee(replyToId).catch(() => null),
        api.getMessage(replyToId).catch(() => null),
      ]);
      if (cancelled) return;

      const senderName = pickSenderName(message?.sender, addressee?.name, params.receiverName);
      if (senderName) setReplyName(senderName);

      if (message?.topic && !looksLikePersonName(message.topic)) {
        setTopic((current) =>
          looksLikePersonName(current.replace(/^re:\s*/i, '')) ? replyTopic(message.topic) : current,
        );
      }

      const officialOk =
        Boolean(plausibleReceiverId(addressee?.id)) &&
        (!senderName || !addressee?.name || namesMatch(addressee.name, senderName));
      if (officialOk && addressee?.id) {
        setReceiverId(addressee.id);
      }

      if (message) {
        setBody((current) => {
          const quoteFrom = looksLikePersonName(message.sender) ? message.sender : senderName || message.sender;
          const quote = quotedReply(quoteFrom, message.body);
          if (!quote) return current;
          if (current.includes(quote.trim())) return current;
          return `${current}${quote}`;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, params.receiverName, params.replyToId]);

  useEffect(() => {
    if (!params.replyToId) {
      if (!receiverId) return;
      const matched = receivers.find((item) => item.id === receiverId);
      const title = matched?.group?.trim();
      if (!title) return;
      setOpenGroups((current) => (current[title] ? current : { ...current, [title]: true }));
      return;
    }

    const matched = matchReceiver(receivers, receiverId, replyName || params.receiverName);
    if (!matched) return;
    if (matched.id !== receiverId) setReceiverId(matched.id);
    const title = matched.group?.trim();
    if (!title) return;
    setOpenGroups((current) => (current[title] ? current : { ...current, [title]: true }));
  }, [params.receiverName, params.replyToId, receiverId, receivers, replyName]);

  if (status !== 'ready') return <Redirect href="/" />;

  const selected = receivers.find((item) => item.id === receiverId);
  const selectedName = selected?.name || replyName || params.receiverName || '';

  function isOpen(title: string): boolean {
    return searching || activeGroup === title || Boolean(openGroups[title]);
  }

  function toggleGroup(title: string) {
    if (searching) return;
    const group = catalog.find((item) => item.label === title);
    setOpenGroups((current) => ({ ...current, [title]: !current[title] }));
    if (group) void loadType(group.id);
  }

  async function onSend() {
    setError(null);
    const resolvedId = selected?.id || receiverId;
    if (!resolvedId && !params.replyToId) {
      setError(
        selectedName
          ? `Nie znaleziono „${selectedName}” na liście. Rozwiń grupę i wybierz odbiorcę.`
          : 'Wybierz odbiorcę.',
      );
      return;
    }
    setBusy(true);
    try {
      await api.sendMessage({
        receiverId: resolvedId || '',
        receiverTypeId: selected?.typeId,
        topic,
        body,
        replyToId: params.replyToId,
      });
      Alert.alert(
        isDemo ? 'Podgląd' : 'Gotowe',
        isDemo ? 'W podglądzie nic nie wysyłamy do szkoły.' : 'Wiadomość wysłana.',
      );
      router.back();
    } catch (caught) {
      setError(messageFromUnknown(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={[listContentStyle({ paddingBottom: __DEV__ ? 140 : 80 }), styles.content]}
        keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: theme.text }]}>Do</Text>
        {selectedName ? (
          <Card style={[styles.selectedCard, { borderColor: theme.tint }]}>
            <Text style={[styles.selectedHint, { color: theme.muted }]}>Odbiorca</Text>
            <Text style={[styles.selectedName, { color: theme.text }]}>{selectedName}</Text>
            {selected?.group ? (
              <Text style={[styles.selectedHint, { color: theme.muted, marginTop: 4 }]}>{selected.group}</Text>
            ) : null}
          </Card>
        ) : null}
        <TextInput
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            if (value.trim()) setActiveGroup(null);
          }}
          placeholder="Szukaj albo wybierz grupę"
          placeholderTextColor={theme.muted}
          autoCorrect={false}
          style={[styles.input, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]}
        />
        {groupTitles.length > 1 && !searching ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={styles.chipRow}>
            {groupTitles.map((title) => (
              <GroupFilterChip
                key={title}
                label={title}
                active={activeGroup === title}
                onPress={() => {
                  setActiveGroup(title);
                  setOpenGroups((current) => ({ ...current, [title]: true }));
                  const group = catalog.find((item) => item.label === title);
                  if (group) void loadType(group.id);
                }}
              />
            ))}
          </ScrollView>
        ) : null}
        {groupError ? <Text style={styles.error}>{groupError}</Text> : null}
        {groupsQuery.loading && catalog.length === 0 ? (
          <LoadingState label="Pobieram grupy odbiorców…" />
        ) : groupsQuery.error && catalog.length === 0 ? (
          <ScreenMessage title="Brak listy odbiorców" body={groupsQuery.error} />
        ) : (
          <View style={styles.receivers}>
            {groups.map((group) => {
              const expanded = isOpen(group.title);
              const typeId = catalog.find((item) => item.label === group.title)?.id;
              const loaded = Boolean(typeId && peopleByType[typeId]);
              const waiting = Boolean(typeId && loadingType === typeId && group.items.length === 0);
              return (
                <View key={group.title} style={styles.group}>
                  <Pressable
                    onPress={() => toggleGroup(group.title)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${group.title}, ${group.items.length} osób`}>
                    <Card style={styles.groupHeader}>
                      <View style={styles.groupHeaderRow}>
                        <Text style={[styles.chevron, { color: theme.muted }]}>{expanded ? '▼' : '▶'}</Text>
                        <Text style={[styles.groupTitle, { color: theme.text }]}>{group.title}</Text>
                        <Text style={[styles.groupCount, { color: theme.muted }]}>
                          {loaded || group.items.length > 0 ? group.items.length : waiting ? '…' : '—'}
                        </Text>
                      </View>
                    </Card>
                  </Pressable>
                  {expanded ? (
                    waiting ? (
                      <Text style={{ color: theme.muted, paddingHorizontal: 4 }}>Pobieram osoby…</Text>
                    ) : group.items.length === 0 ? (
                      <Text style={{ color: theme.muted, paddingHorizontal: 4 }}>
                        Brak osób w tej grupie. Jeśli to rodzice albo rada, potrzebny jest numer klasy z Librusa.
                      </Text>
                    ) : (
                      group.items.map((receiver) => {
                        const isSelected = receiver.id === (selected?.id || receiverId);
                        return (
                          <Pressable
                            key={receiver.id}
                            onPress={() => setReceiverId(receiver.id)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: isSelected }}
                            accessibilityLabel={receiver.name}>
                            <Card
                              style={[
                                styles.receiver,
                                isSelected ? { borderColor: theme.tint, borderWidth: 2 } : null,
                              ]}>
                              <View style={styles.receiverRow}>
                                <View
                                  style={[
                                    styles.radio,
                                    { borderColor: isSelected ? theme.tint : theme.line },
                                    isSelected ? { backgroundColor: theme.tint } : null,
                                  ]}
                                />
                                <Text
                                  style={[
                                    styles.receiverName,
                                    { color: theme.text, fontWeight: isSelected ? '800' : '600' },
                                  ]}>
                                  {receiver.name}
                                </Text>
                              </View>
                            </Card>
                          </Pressable>
                        );
                      })
                    )
                  ) : null}
                </View>
              );
            })}
            {groups.length === 0 ? (
              <View style={{ gap: 12 }}>
                <Text style={{ color: theme.muted }}>
                  {searching
                    ? 'Brak pasujących nazwisk. Wybierz grupę albo wyszukaj po załadowaniu osób.'
                    : 'Nie udało się pobrać listy grup. Sprawdź internet i spróbuj ponownie.'}
                </Text>
                {!searching ? (
                  <PrimaryButton label="Spróbuj ponownie" onPress={() => void groupsQuery.reload()} />
                ) : null}
              </View>
            ) : null}
          </View>
        )}

        <Text style={[styles.label, { color: theme.text }]}>Temat</Text>
        <TextInput
          value={topic}
          onChangeText={setTopic}
          placeholder="Temat wiadomości"
          placeholderTextColor={theme.muted}
          style={[styles.input, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]}
        />

        <Text style={[styles.label, { color: theme.text }]}>Treść</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={params.replyToId ? 'Napisz odpowiedź nad cytatem' : 'Napisz wiadomość do szkoły'}
          placeholderTextColor={theme.muted}
          multiline
          textAlignVertical="top"
          style={[
            styles.input,
            styles.body,
            { color: theme.text, backgroundColor: theme.card, borderColor: theme.line },
          ]}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          label={busy ? 'Wysyłam…' : params.replyToId ? 'Wyślij odpowiedź' : 'Wyślij'}
          onPress={() => void onSend()}
          disabled={busy || !topic.trim() || !hasOwnText(body, Boolean(params.replyToId))}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function visibleGroups(
  catalog: SchoolReceiverGroup[],
  peopleByType: Record<string, SchoolReceiver[]>,
  query: string,
  onlyGroup?: string | null,
): Array<{ title: string; items: SchoolReceiver[] }> {
  const needle = query.trim().toLowerCase();
  const titles = [
    ...GROUP_ORDER.filter((title) => catalog.some((item) => item.label === title)),
    ...catalog.map((item) => item.label).filter((title) => !GROUP_ORDER.includes(title)),
  ];
  return titles
    .filter((title) => !onlyGroup || title === onlyGroup)
    .map((title) => {
      const group = catalog.find((item) => item.label === title);
      const items = ((group && peopleByType[group.id]) ?? []).filter((item) => {
        if (!needle) return true;
        return (
          item.name.toLowerCase().includes(needle) || (item.group ?? '').toLowerCase().includes(needle)
        );
      });
      return {
        title,
        items: items.sort((a, b) => a.name.localeCompare(b.name, 'pl')),
      };
    })
    .filter((group) => !needle || group.items.length > 0);
}

function matchReceiver(
  receivers: SchoolReceiver[],
  id?: string,
  name?: string,
): SchoolReceiver | undefined {
  if (id) {
    const exact = receivers.find((item) => item.id === id);
    if (exact && plausibleReceiverId(id) && (!name || namesMatch(exact.name, name) || !looksLikePersonName(name))) {
      return exact;
    }
  }
  if (!name?.trim()) return undefined;
  const named = receivers.find((item) => namesMatch(item.name, name));
  if (named) return named;
  const needle = normalizeName(name);
  const exactName = receivers.find((item) => normalizeName(item.name) === needle);
  if (exactName) return exactName;
  const parts = needle.split(' ').filter((part) => part.length > 1);
  if (parts.length < 2) return undefined;
  return receivers.find((item) => {
    const current = normalizeName(item.name);
    return parts.every((part) => current.includes(part));
  });
}

function pickSenderName(...candidates: Array<string | undefined>): string {
  const person = candidates.find((value) => value && looksLikePersonName(value));
  if (person) return person;
  return candidates.find((value) => value?.trim()) ?? '';
}

function GroupFilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.filterChip,
        {
          backgroundColor: active ? theme.tint : theme.card,
          borderColor: active ? theme.tint : theme.line,
        },
      ]}>
      <Text style={[styles.filterChipLabel, { color: active ? '#fff' : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

function hasOwnText(body: string, isReply: boolean): boolean {
  if (!isReply) return Boolean(body.trim());
  return Boolean(body.split(/\n---\n/)[0]?.trim());
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[—–-]/g, ' ').replace(/\s+/g, ' ').trim();
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: 8 },
  label: { fontSize: 15, fontWeight: '700', marginBottom: 8, marginTop: 8 },
  selectedCard: { borderWidth: 2, marginBottom: 10, paddingVertical: 12 },
  selectedHint: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
  selectedName: { fontSize: 17, fontWeight: '800' },
  receivers: { gap: 10, marginBottom: 8 },
  chipRow: { marginBottom: 12, flexGrow: 0 },
  chips: { gap: 8, paddingRight: 8 },
  filterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterChipLabel: { fontSize: 14, fontWeight: '700' },
  group: { gap: 8 },
  groupHeader: { paddingVertical: 12 },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chevron: { width: 16, fontSize: 12, fontWeight: '800' },
  groupTitle: { flex: 1, flexShrink: 1, fontSize: 16, fontWeight: '800' },
  groupCount: { fontSize: 14, fontWeight: '600' },
  receiver: { paddingVertical: 12 },
  receiverRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, flexShrink: 0 },
  receiverName: { flex: 1, flexShrink: 1, fontSize: 16, lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    marginBottom: 8,
  },
  body: { minHeight: 160 },
  error: { color: '#B42318', marginBottom: 12, fontSize: 15, lineHeight: 20 },
});
