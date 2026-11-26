// New-message notifications: first run, real new mail, foreground, and an inbox source switch.
import { readFileSync } from 'node:fs';

import { notifyNewInboxMessages } from '../src/background/notifications';
import type { SchoolMessage } from '../src/librus/types';
import { AppState } from './test-support/shims/react-native';
import { scheduled } from './test-support/shims/expo-notifications';

let failed = 0;
function assert(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`ok  ${label}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${label}`);
  if (detail !== undefined) console.error(detail);
}

const message = (id: string, topic: string, sender = 'Nowak Anna [Nauczyciel]'): SchoolMessage => ({
  id,
  topic,
  sender,
  body: '',
  sentAt: '2026-11-25 21:24:00',
  read: false,
  hasAttachments: false,
  kind: 'inbox',
});

async function main() {
  const api = [message('w-3', 'Zebranie'), message('w-2', 'Basen'), message('w-1', 'Wycieczka')];

  await notifyNewInboxMessages(api, 'acc', 'Jan');
  assert('first sync only records what is there', scheduled.length === 0, scheduled);

  await notifyNewInboxMessages([message('w-4', 'Zmiana planu', 'Lis Tomasz [Dyrektor Szkoły]'), ...api], 'acc', 'Jan');
  assert('one new message gives one notification', scheduled.length === 1, scheduled);
  assert('notification names the sender', scheduled[0]?.content.title === 'Jan: Lis Tomasz [Dyrektor Szkoły]', scheduled[0]);
  assert('notification body is the subject', scheduled[0]?.content.body === 'Zmiana planu', scheduled[0]);

  AppState.currentState = 'active';
  await notifyNewInboxMessages([message('w-5', 'Wywiadówka'), message('w-4', 'Zmiana planu'), ...api], 'acc', 'Jan');
  assert('no notification while the app is open', scheduled.length === 1, scheduled);
  AppState.currentState = 'background';

  // Same inbox, now read from the synergia HTML page under different ids.
  const synergia = [message('5-905', 'Wywiadówka'), message('5-904', 'Zmiana planu'), message('5-903', 'Zebranie')];
  await notifyNewInboxMessages(synergia, 'acc', 'Jan');
  assert('switching inbox source does not announce every message', scheduled.length === 1, scheduled);

  await notifyNewInboxMessages([message('5-906', 'Dzień sportu'), ...synergia], 'acc', 'Jan');
  assert('new mail after the switch is announced', scheduled.length === 2 && scheduled[1]?.content.body === 'Dzień sportu', scheduled);

  await notifyNewInboxMessages([message('5-906', 'Dzień sportu'), ...synergia], 'other', 'Ola');
  assert('a second account starts its own baseline', scheduled.length === 2, scheduled);

  // Android starts the app without drawing a screen for a background sync, so app/_layout.tsx never
// loads. The task must be defined from the entry file, before expo-router, or nothing ever syncs.
const entry = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { main?: string };
assert('the app starts from index.ts', pkg.main === 'index.ts', pkg.main);
assert(
  'the background sync task is defined before expo-router loads',
  entry.includes("import './src/background/syncTask'") &&
    entry.indexOf('syncTask') < entry.indexOf("import 'expo-router/entry'"),
);

if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
}

void main();
