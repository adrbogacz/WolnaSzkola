import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';

import { useAuth } from '@/src/auth/AuthContext';
import { formatDate, formatDateTime, listContentStyle, sortNewest } from '@/src/format';
import { useSchoolQuery } from '@/src/hooks/useSchoolQuery';
import type { HideStatus } from '@/src/appSettings';
import type { SchoolMessage } from '@/src/librus/types';
import { Card, DemoBanner, LoadingState, ScreenMessage, useTheme } from '@/src/ui';
import { alignMessageFields, composeReplyParams } from '@/src/reply';
import { palette } from '@/constants/Colors';

type InboxTab = 'inbox' | 'sent' | 'notice';

const TAB_COPY: Record<
  InboxTab,
  { loading: string; error: string; emptyTitle: string; emptyBody: string }
> = {
  inbox: {
    loading: 'Pobieram wiadomości…',
    error: 'Nie udało się wczytać wiadomości',
    emptyTitle: 'Skrzynka jest pusta',
    emptyBody: 'Gdy nauczyciel wyśle wiadomość, pojawi się tutaj.',
  },
  sent: {
    loading: 'Pobieram wysłane…',
    error: 'Nie udało się wczytać wysłanych',
    emptyTitle: 'Nic jeszcze nie wysłano',
    emptyBody: 'Wiadomości, które wyślesz do szkoły, pojawią się tutaj.',
  },
  notice: {
    loading: 'Pobieram ogłoszenia…',
    error: 'Nie udało się wczytać ogłoszeń',
    emptyTitle: 'Brak ogłoszeń',
    emptyBody: 'Gdy szkoła doda ogłoszenie, pojawi się tutaj.',
  },
};

export default function MessagesScreen() {
  const { status, isDemo, api, isItemRead, setItemRead, hideStatus, hideItem, showArchived } = useAuth();
  const theme = useTheme();
  const [tab, setTab] = useState<InboxTab>('inbox');
  const messagesQuery = useSchoolQuery((force) => api.getMessages({ force }), [api], () => api.peekMessages());
  const sentQuery = useSchoolQuery((force) => api.getSentMessages({ force }), [api], () => api.peekSentMessages());
  const noticesQuery = useSchoolQuery((force) => api.getAnnouncements({ force }), [api], () => api.peekAnnouncements());
  const reloadSent = sentQuery.reload;

  useFocusEffect(
    useCallback(() => {
      if (tab === 'sent') void reloadSent(false);
    }, [reloadSent, tab]),
  );

  if (status !== 'ready') return <Redirect href="/" />;

  const query = tab === 'inbox' ? messagesQuery : tab === 'sent' ? sentQuery : noticesQuery;
  const copy = TAB_COPY[tab];
  const items = sortNewest(query.data ?? [])
    .map((item) => ({
      ...item,
      read: isItemRead(item.id, item.read),
    }))
    .filter((item) => {
      const hidden = hideStatus(item.id);
      if (hidden === 'deleted') return false;
      if (hidden === 'archived' && !showArchived) return false;
      return true;
    });

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      {isDemo ? <DemoBanner /> : null}
      <View style={[styles.switcher, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <TabChip label="Odebrane" active={tab === 'inbox'} onPress={() => setTab('inbox')} />
        <TabChip label="Wysłane" active={tab === 'sent'} onPress={() => setTab('sent')} />
        <TabChip label="Ogłoszenia" active={tab === 'notice'} onPress={() => setTab('notice')} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={listContentStyle({ gap: 0 })}
        extraData={`${showArchived}|${items.map((item) => `${item.id}:${item.read}:${hideStatus(item.id) ?? ''}`).join('|')}`}
        refreshing={query.refreshing}
        onRefresh={() => void query.reload(true)}
        ListEmptyComponent={
          query.loading ? (
            <LoadingState label={copy.loading} />
          ) : query.error ? (
            <ScreenMessage
              title={copy.error}
              body={query.error}
              actionLabel="Spróbuj ponownie"
              onAction={() => void query.reload()}
            />
          ) : (
            <ScreenMessage title={copy.emptyTitle} body={copy.emptyBody} />
          )
        }
        renderItem={({ item }) => (
          <SwipeableMessage
            message={item}
            archived={hideStatus(item.id) === 'archived'}
            onToggleRead={() => setItemRead(item.id, !item.read)}
            onHide={(action) => hideItem(item.id, action)}
          />
        )}
      />
    </View>
  );
}

function TabChip({
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
      style={[styles.chip, active ? { backgroundColor: theme.tint } : null]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}>
      <Text style={[styles.chipLabel, { color: active ? '#fff' : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

function SwipeableMessage({
  message,
  archived,
  onToggleRead,
  onHide,
}: {
  message: SchoolMessage;
  archived: boolean;
  onToggleRead: () => void;
  onHide: (action: HideStatus) => Promise<void>;
}) {
  const swipeRef = useRef<Swipeable>(null);

  return (
    <Swipeable
      ref={swipeRef}
      overshootRight={false}
      containerStyle={styles.swipe}
      renderRightActions={() => (
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              swipeRef.current?.close();
              void onHide('archived');
            }}
            style={[styles.action, { backgroundColor: palette.amber }]}
            accessibilityRole="button"
            accessibilityLabel="Archiwum">
            <Text style={styles.actionLabel}>Archiwum</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              swipeRef.current?.close();
              void onHide('deleted');
            }}
            style={[styles.action, { backgroundColor: palette.red }]}
            accessibilityRole="button"
            accessibilityLabel="Usuń">
            <Text style={styles.actionLabel}>Usuń</Text>
          </Pressable>
        </View>
      )}>
      <MessageRow message={message} archived={archived} onToggleRead={onToggleRead} />
    </Swipeable>
  );
}

function MessageRow({
  message,
  archived,
  onToggleRead,
}: {
  message: SchoolMessage;
  archived: boolean;
  onToggleRead: () => void;
}) {
  const theme = useTheme();
  const stamped = /[:T ]\d{2}:\d{2}/.test(message.sentAt)
    ? formatDateTime(message.sentAt)
    : formatDate(message.sentAt);
  const aligned = alignMessageFields(message.topic, message.sender);
  const personLabel = message.kind === 'sent' ? `Do: ${aligned.sender}` : aligned.sender;

  return (
    <Card style={styles.card}>
      <Pressable onPress={() => router.push({ pathname: '/message/[id]', params: { id: message.id } })} accessibilityRole="button">
        <View style={styles.row}>
          {!message.read && message.kind === 'inbox' ? (
            <View style={[styles.dot, { backgroundColor: theme.accent }]} />
          ) : (
            <View style={styles.dotSpacer} />
          )}
          <View style={styles.body}>
            <Text style={[styles.sender, { color: theme.muted }]} numberOfLines={1}>
              {personLabel}
            </Text>
            <Text style={[styles.topic, { color: theme.text }]} numberOfLines={2}>
              {aligned.topic}
            </Text>
            <Text style={[styles.date, { color: theme.muted }]}>
              {stamped}
              {archived ? ' · archiwum' : ''}
            </Text>
          </View>
        </View>
      </Pressable>
      <View style={styles.rowActions}>
        {message.kind === 'inbox' ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/compose',
                params: composeReplyParams(message),
              })
            }
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Odpowiedz">
            <Text style={[styles.mark, { color: theme.tint }]}>Odpowiedz</Text>
          </Pressable>
        ) : null}
        {message.kind === 'sent' ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/compose',
                params: {
                  receiverId: message.senderId ?? '',
                  receiverName: aligned.sender,
                  topic: aligned.topic,
                },
              })
            }
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Napisz ponownie">
            <Text style={[styles.mark, { color: theme.tint }]}>Napisz ponownie</Text>
          </Pressable>
        ) : null}
        {message.kind === 'inbox' || message.kind === 'notice' ? (
          <Pressable
            onPress={onToggleRead}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={message.read ? 'Oznacz jako nieprzeczytane' : 'Oznacz jako przeczytane'}>
            <Text style={[styles.mark, { color: theme.tint }]}>
              {message.read ? 'Oznacz jako nieprzeczytane' : 'Oznacz jako przeczytane'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  switcher: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  chip: { flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  chipLabel: { fontSize: 13, fontWeight: '700' },
  swipe: { marginBottom: 12 },
  card: { paddingVertical: 14 },
  row: { flexDirection: 'row', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  dotSpacer: { width: 10 },
  body: { flex: 1, flexShrink: 1 },
  sender: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  topic: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  date: { marginTop: 8, fontSize: 13 },
  rowActions: { marginTop: 10, marginLeft: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  mark: { fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', width: 168 },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  actionLabel: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
