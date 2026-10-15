import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { useAuth } from '@/src/auth/AuthContext';
import { formatSentAt } from '@/src/format';
import { useSchoolQuery } from '@/src/hooks/useSchoolQuery';
import { alignMessageFields, composeReplyParams } from '@/src/reply';
import { Card, LoadingState, PrimaryButton, ScreenMessage, SyncBanner, useTheme } from '@/src/ui';

export default function MessageDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const { status, api, isItemRead, setItemRead } = useAuth();
  const theme = useTheme();
  const messageId = firstRouteParam(id);
  // The list row (or a cached body) renders instantly; the full body fills in below the header.
  const query = useSchoolQuery(
    (force) => api.getMessage(messageId, { force }),
    [api, messageId],
    () => api.peekMessage(messageId),
  );
  const [copied, setCopied] = useState(false);
  const paragraphs = useMemo(() => splitParagraphs(query.data?.body ?? ''), [query.data?.body]);

  const markedId = useRef<string | null>(null);

  useEffect(() => {
    const openedId = query.data?.id;
    // Wait for the real open: the detail fetch itself marks the message read on the server.
    if (!openedId || query.fetching || query.error || query.syncError || markedId.current === openedId) return;
    markedId.current = openedId;
    setItemRead(openedId, true);
    void api.markServerRead(openedId);
  }, [api, query.data?.id, query.error, query.fetching, query.syncError, setItemRead]);

  if (status !== 'ready') return <Redirect href="/" />;

  if (query.loading && !query.data) {
    return <LoadingState label="Otwieram wiadomość…" />;
  }

  if (!query.data) {
    return (
      <ScreenMessage
        title="Nie udało się otworzyć wiadomości"
        body={query.error ?? 'Brak treści.'}
        actionLabel="Spróbuj ponownie"
        onAction={() => void query.reload()}
      />
    );
  }

  const message = query.data;
  const aligned = alignMessageFields(message.topic, message.sender);
  const read = isItemRead(message.id, true);
  const canReply = message.kind === 'inbox';
  const canWriteAgain = message.kind === 'sent';
  const bodyPending = paragraphs.length === 0 && query.fetching;
  // Header came from the cache but the body could not be loaded: say so in place of the body.
  const bodyError = paragraphs.length === 0 && !bodyPending ? (query.error ?? query.syncError?.message ?? null) : null;

  async function copyMessage() {
    const text = [aligned.topic, aligned.sender, message.body].filter(Boolean).join('\n\n');
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ScrollView
      testID="message-detail"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}>
      {query.syncError && !bodyError ? <SyncBanner error={query.syncError} onRetry={() => void query.reload(true)} /> : null}
      <Text testID="message-topic" selectable style={[styles.topic, { color: theme.text }]}>
        {aligned.topic}
      </Text>
      <Text selectable style={[styles.meta, { color: theme.muted }]}>
        {message.kind === 'notice' ? 'Ogłoszenie · ' : message.kind === 'sent' ? 'Do · ' : ''}
        {aligned.sender}
        {message.sentAt ? ` · ${formatSentAt(message.sentAt)}` : ''}
      </Text>
      <Card style={styles.bodyCard}>
        {bodyPending ? (
          <View testID="message-body-placeholder" accessibilityLabel="Wczytuję treść" style={styles.placeholder}>
            {PLACEHOLDER_LINES.map((width) => (
              <View key={width} style={[styles.placeholderLine, { width, backgroundColor: theme.line }]} />
            ))}
          </View>
        ) : bodyError ? (
          <View testID="message-body-error">
            <Text style={[styles.body, { color: theme.muted }]}>{bodyError}</Text>
            <Pressable onPress={() => void query.reload()} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.markLabel, { color: theme.tint }]}>Spróbuj ponownie</Text>
            </Pressable>
          </View>
        ) : (
          <View testID="message-body">
            {paragraphs.length === 0 ? (
              <Text style={[styles.body, { color: theme.text }]}>Brak treści.</Text>
            ) : (
              // One Text per paragraph: a single huge selectable Text is slow to lay out on Android.
              paragraphs.map((paragraph, index) => (
                <Text
                  key={index}
                  selectable
                  style={[styles.body, index > 0 ? styles.paragraphGap : null, { color: theme.text }]}>
                  {paragraph}
                </Text>
              ))
            )}
          </View>
        )}
      </Card>
      <Pressable
        onPress={() => void copyMessage()}
        style={[styles.markBtn, { borderColor: theme.line }]}
        accessibilityRole="button"
        accessibilityLabel="Kopiuj treść">
        <Text style={[styles.markLabel, { color: theme.tint }]}>{copied ? 'Skopiowano' : 'Kopiuj treść'}</Text>
      </Pressable>
      {message.hasAttachments ? (
        <Text style={[styles.attach, { color: theme.muted }]}>
          Ta wiadomość ma załączniki — na razie otwórz je na stronie synergia.librus.pl.
        </Text>
      ) : null}
      {message.kind !== 'sent' ? (
        <Pressable
          onPress={() => setItemRead(message.id, !read)}
          style={[styles.markBtn, { borderColor: theme.line }]}
          accessibilityRole="button">
          <Text style={[styles.markLabel, { color: theme.tint }]}>
            {read ? 'Oznacz jako nieprzeczytane' : 'Oznacz jako przeczytane'}
          </Text>
        </Pressable>
      ) : null}
      {canReply ? (
        <View style={styles.reply}>
          <PrimaryButton
            label="Odpowiedz"
            onPress={() =>
              router.push({
                pathname: '/compose',
                params: composeReplyParams(message),
              })
            }
          />
        </View>
      ) : canWriteAgain ? (
        <View style={styles.reply}>
          <PrimaryButton
            label="Napisz ponownie"
            onPress={() =>
              router.push({
                pathname: '/compose',
                params: {
                  receiverId: message.senderId ?? '',
                  receiverName: message.sender,
                  topic: message.topic,
                },
              })
            }
          />
        </View>
      ) : (
        <Text style={[styles.noticeHint, { color: theme.muted }]}>
          Ogłoszenia szkoły nie da się odebrać wiadomością z tej listy — napisz do nauczyciela z Nowej wiadomości.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  topic: { fontSize: 24, fontWeight: '800', lineHeight: 30 },
  meta: { marginTop: 8, fontSize: 15 },
  bodyCard: { marginTop: 18 },
  body: { fontSize: 17, lineHeight: 26 },
  paragraphGap: { marginTop: 14 },
  placeholder: { gap: 12, minHeight: 104, paddingVertical: 4 },
  placeholderLine: { height: 14, borderRadius: 7, opacity: 0.8 },
  attach: { marginTop: 14, fontSize: 14, lineHeight: 20 },
  markBtn: {
    marginTop: 18,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  markLabel: { fontSize: 15, fontWeight: '700' },
  reply: { marginTop: 24 },
  noticeHint: { marginTop: 18, fontSize: 14, lineHeight: 20 },
});

const PLACEHOLDER_LINES = ['92%', '100%', '78%', '64%'] as const;

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function firstRouteParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
