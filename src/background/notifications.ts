import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import type { SchoolMessage } from '@/src/librus/types';
import { loadSeenMessageIds, saveSeenMessageIds } from '@/src/storage';

const CHANNEL = 'messages';

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const inForeground = AppState.currentState === 'active';
      return {
        shouldShowBanner: !inForeground,
        shouldShowList: !inForeground,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
} catch {
  // Web preview or missing native module.
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return false;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Wiadomości',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function notifyNewInboxMessages(
  messages: SchoolMessage[],
  accountId = '',
  accountLabel = '',
): Promise<void> {
  if (Platform.OS === 'web') return;

  const ids = messages.map((message) => message.id).filter(Boolean);
  const previous = await loadSeenMessageIds(accountId);
  if (previous.length === 0) {
    await saveSeenMessageIds(ids, accountId);
    return;
  }

  const seen = new Set(previous);
  const fresh = messages.filter((message) => message.id && !seen.has(message.id));
  await saveSeenMessageIds([...new Set([...previous, ...ids])].slice(-200), accountId);
  if (fresh.length === 0 || AppState.currentState === 'active') return;

  const latest = fresh[0];
  const who = fresh.length === 1 ? latest?.sender || 'Nowa wiadomość' : `${fresh.length} nowych wiadomości`;
  const title = accountLabel ? `${accountLabel}: ${who}` : who;
  const body =
    fresh.length === 1
      ? latest?.topic || 'Nowa wiadomość w dzienniku'
      : fresh
          .slice(0, 3)
          .map((message) => message.topic)
          .filter(Boolean)
          .join(' · ');

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { href: '/(tabs)/messages' },
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
  } catch {
    // Missing native module or permission.
  }
}

export function subscribeNotificationNavigation(openInbox: () => void): () => void {
  if (Platform.OS === 'web') return () => undefined;

  const subscription = Notifications.addNotificationResponseReceivedListener(() => {
    openInbox();
  });

  try {
    const response = Notifications.getLastNotificationResponse();
    if (response) {
      openInbox();
      Notifications.clearLastNotificationResponse();
    }
  } catch {
    // Missing native module.
  }

  return () => subscription.remove();
}
