// Integration test: drives the real LibrusClient and storage against a fake Librus server.
// Run with `npm test` (plain Node, no device needed).
import { decodeBytesAsText } from '../src/format';
import { LibrusClient } from '../src/librus/client';
import { errorKind, StaleResultError } from '../src/librus/errors';
import { httpConfig } from '../src/librus/http';
import { loadReadState, saveReadState } from '../src/storage';
import { files } from './test-support/shims/expo-file-system';
import { options as secureOptions, store as secureStore } from './test-support/shims/expo-secure-store';
import { inboxFixture, messageDetailFixture, POLISH_SAMPLE } from './test-support/librus-fixtures';

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- fake Librus -----------------------------------------------------------

type Handler = (url: string, init: RequestInit) => Promise<Response>;
const hits: string[] = [];
let routes: Array<[RegExp, Handler]> = [];

function json(body: unknown, { status = 200, delayMs = 0 } = {}): Handler {
  return async () => {
    if (delayMs) await sleep(delayMs);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

function html(body: string, delayMs = 0): Handler {
  return async () => {
    if (delayMs) await sleep(delayMs);
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  };
}

const hang: Handler = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  });

const networkDown: Handler = async () => {
  throw new TypeError('Network request failed');
};

function sessionRoutes(refreshDelayMs = 0): Array<[RegExp, Handler]> {
  return [
    [/synergia\.librus\.pl\/refreshToken/, html('{}', refreshDelayMs)],
    [/api\.librus\.pl\/3\.0\/Auth\//, json({})],
    [/synergia\.librus\.pl\/wiadomosci[23]$/, html('<html></html>')],
  ];
}

globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  hits.push(url);
  const route = routes.find(([pattern]) => pattern.test(url));
  if (!route) return new Response('not found', { status: 404 });
  return route[1](url, init);
}) as typeof fetch;

function count(pattern: RegExp): number {
  return hits.filter((url) => pattern.test(url)).length;
}

function makeClient(childLogin = 'anna'): LibrusClient {
  const client = new LibrusClient();
  // Skip the OAuth login dance: start from an established parent session.
  Object.assign(client, {
    email: 'rodzic@example.com',
    password: 'x',
    portalReady: true,
    child: { id: childLogin === 'anna' ? 1 : 2, login: childLogin, studentName: childLogin, accessToken: 't', state: '' },
  });
  return client;
}

const INBOX = /wiadomosci\.librus\.pl\/api\/inbox\/messages\?/;
const DETAIL = /wiadomosci\.librus\.pl\/api\/inbox\/messages\/101$/;

async function main() {
  // 1. Inbox renders on startup: parsed, Polish text intact, newest first.
  routes = [...sessionRoutes(), [INBOX, json(inboxFixture())], [DETAIL, json(messageDetailFixture())]];
  const client = makeClient();
  const inbox = await client.getMessages({ force: true });
  assert('inbox parses every thread', inbox.length === 3, inbox);
  assert('inbox is sorted newest first', inbox.map((m) => m.id).join(',') === 'w-103,w-101,w-102', inbox.map((m) => m.id));
  assert('Polish subject survives decoding', inbox.some((m) => m.topic === 'Wycieczka – zgoda rodziców'), inbox.map((m) => m.topic));
  assert('unread flag comes from readDate', inbox.find((m) => m.id === 'w-103')?.read === false);

  // 2. Opening a multi-paragraph message decodes the base64 HTML body.
  const opened = await client.getMessage('w-101');
  assert('body decodes Polish characters', opened.body.includes(POLISH_SAMPLE), opened.body);
  assert('paragraphs stay separate', opened.body.split('\n\n').length >= 3, opened.body);
  assert('no HTML tags leak into the body', !/<[a-z]/i.test(opened.body), opened.body);

  // 3. Opening already marked it read on the server: no second GET.
  const detailHits = count(DETAIL);
  await client.markServerRead('w-101');
  assert('markServerRead skips the duplicate detail fetch', count(DETAIL) === detailHits);

  // 4. Network down with a warm cache: error says offline, cache still readable.
  routes = [...sessionRoutes(), [/librus\.pl/, networkDown]];
  let offlineKind = '';
  try {
    await client.getMessages({ force: true });
  } catch (error) {
    offlineKind = errorKind(error);
  }
  assert('offline sync fails with kind "offline"', offlineKind === 'offline', offlineKind);
  assert('cached inbox is still served while offline', (await client.peekMessages())?.length === 3);
  const offlineOpen = await client.getMessage('w-101', { force: true });
  assert('an opened message stays readable offline', offlineOpen.body.includes(POLISH_SAMPLE));

  // 5. A hung server times out instead of spinning forever, without walking every fallback.
  httpConfig.timeoutMs = 200;
  routes = [...sessionRoutes(), [INBOX, hang]];
  const hungClient = makeClient();
  const started = Date.now();
  let hungKind = '';
  try {
    await hungClient.getMessages({ force: true });
  } catch (error) {
    hungKind = errorKind(error);
  }
  assert('hung inbox request fails with kind "timeout"', hungKind === 'timeout', hungKind);
  assert('timeout gives up quickly', Date.now() - started < 2_000, Date.now() - started);
  assert('no fallback requests after a timeout', count(/api\.librus\.pl\/3\.0\/Messages|synergia\.librus\.pl\/wiadomosci\/5/) === 0);
  httpConfig.timeoutMs = 15_000;

  // 6. Three screens loading at once share one session bootstrap.
  hits.length = 0;
  routes = [...sessionRoutes(60), [INBOX, json(inboxFixture())], [/outbox\/messages\?/, json({ data: [] })], [DETAIL, json(messageDetailFixture())]];
  const parallel = makeClient();
  await Promise.allSettled([parallel.getMessages({ force: true }), parallel.getSentMessages({ force: true }), parallel.getMessage('w-101')]);
  assert('parallel loads run one session bootstrap', count(/refreshToken/) === 1, count(/refreshToken/));

  // 7. Switching child while the inbox is loading never leaks child A's inbox into child B.
  routes = [...sessionRoutes(), [INBOX, json(inboxFixture(), { delayMs: 80 })]];
  const switching = makeClient('anna');
  const pending = switching.getMessages({ force: true });
  await sleep(10);
  await switching.selectChild({ id: 2, login: 'jan', studentName: 'Jan', accessToken: 't', state: '' });
  let stale = false;
  try {
    await pending;
  } catch (error) {
    stale = error instanceof StaleResultError;
  }
  assert('late result for the previous child is rejected as stale', stale);
  assert("new child's inbox cache stays empty", (await switching.peekMessages()) === null);
  assert('nothing was written to disk under the new child', ![...files.keys()].some((key) => key.includes('_jan/inbox')), [...files.keys()]);

  // 8. Rapid read toggles never corrupt the stored flags; old SecureStore data migrates.
  secureOptions.delayMs = 3;
  secureStore.set('wolnaszkola.readState.acc.n', '2');
  secureStore.set('wolnaszkola.readState.acc.0', '{"w-1":tr');
  secureStore.set('wolnaszkola.readState.acc.1', 'ue}');
  const migrated = await loadReadState('acc');
  assert('legacy chunked read state migrates', migrated['w-1'] === true, migrated);
  assert('legacy SecureStore chunks are removed', !secureStore.has('wolnaszkola.readState.acc.0'));
  const writes: Array<Promise<void>> = [];
  let state: Record<string, boolean> = { ...migrated };
  for (let index = 0; index < 20; index += 1) {
    state = { ...state, [`w-${index + 10}`]: index % 2 === 0 };
    writes.push(saveReadState(state, 'acc'));
  }
  await Promise.all(writes);
  const reloaded = await loadReadState('acc');
  assert('20 rapid toggles leave exactly the last state', JSON.stringify(reloaded) === JSON.stringify(state), reloaded);
  secureOptions.delayMs = 0;

  // 9. Decoding: clean UTF-8 takes the fast path; double-encoded Polish is still repaired.
  const clean = `{"topic":"${POLISH_SAMPLE}"}`;
  assert('clean UTF-8 decodes unchanged', decodeBytesAsText(new TextEncoder().encode(clean)) === clean);
  const doubleEncoded = new TextEncoder().encode(
    String.fromCharCode(...new TextEncoder().encode('Dziękuję za wiadomość')),
  );
  assert('mojibake is still repaired', decodeBytesAsText(doubleEncoded) === 'Dziękuję za wiadomość', decodeBytesAsText(doubleEncoded));

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
}

void main();
