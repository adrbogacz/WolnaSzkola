import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { notifyNewInboxMessages } from '@/src/background/notifications';
import { LibrusClient } from '@/src/librus/client';
import { loadAccounts } from '@/src/storage';

export const SYNC_TASK = 'wolnaszkola-sync';

if (!TaskManager.isTaskDefined(SYNC_TASK)) {
  TaskManager.defineTask(SYNC_TASK, async () => {
    try {
      const { accounts } = await loadAccounts();
      if (accounts.length === 0) return BackgroundTask.BackgroundTaskResult.Success;

      for (const account of accounts) {
        const client = new LibrusClient();
        try {
          await client.login(account.login, account.password);
          const messages = await client.getMessages({ force: true });
          await notifyNewInboxMessages(messages, account.id, account.label);
          await client.getAnnouncements();
        } catch {
          // One school can fail without skipping the others.
        } finally {
          client.resetSession();
        }
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function applySyncInterval(minutes: number): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const registered = await TaskManager.isTaskRegisteredAsync(SYNC_TASK);
    if (!minutes || minutes <= 0) {
      if (registered) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
      return;
    }

    const minimumInterval = Platform.OS === 'android' ? Math.max(minutes, 15) : minutes;
    await BackgroundTask.registerTaskAsync(SYNC_TASK, {
      minimumInterval,
    });
  } catch {
    // Expo Go, simulator, or missing native module.
  }
}
