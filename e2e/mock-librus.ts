// Local stand-in for api/synergia/wiadomosci.librus.pl used by the Detox suite.
// The e2e app build sets EXPO_PUBLIC_LIBRUS_MOCK_URL so every Librus request lands here as
// /<host>/<path>. Tests switch behaviour with: POST /__scenario {"name": "normal" | "librus-down"}.
import http from 'node:http';

import { inboxFixture, messageDetailFixture } from '../scripts/test-support/librus-fixtures';

const PORT = Number(process.env.MOCK_PORT ?? 9091);
const DETAIL_DELAY_MS = 1500; // long enough for the test to see the placeholder before the body
let scenario: 'normal' | 'librus-down' = 'normal';

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8` });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/__scenario' && req.method === 'POST') {
    const { name } = JSON.parse((await readBody(req)) || '{}') as { name?: typeof scenario };
    scenario = name === 'librus-down' ? 'librus-down' : 'normal';
    return send(res, 200, { scenario });
  }

  if (scenario === 'librus-down' && path.startsWith('/wiadomosci/api/')) {
    return send(res, 503, '<h1>Przerwa techniczna</h1>', 'text/html');
  }

  // Login: portal handshake, OAuth form, then the gateway session.
  if (path === '/api/OAuth/Authorization' && req.method === 'POST') return send(res, 200, { status: 'ok' });
  if (path.endsWith('/Me')) return send(res, 200, { Me: { Account: { FirstName: 'Jan', LastName: 'Testowy' } } });
  if (path.endsWith('/SchoolNotices')) return send(res, 200, { SchoolNotices: [] });
  if (path.endsWith('/Users')) return send(res, 200, { Users: [] });

  // Messages.
  if (path === '/wiadomosci/api/inbox/messages') return send(res, 200, inboxFixture(40));
  const detail = path.match(/^\/wiadomosci\/api\/inbox\/messages\/(\d+)$/);
  if (detail?.[1]) {
    await new Promise((resolve) => setTimeout(resolve, DETAIL_DELAY_MS));
    return send(res, 200, messageDetailFixture(detail[1]));
  }
  if (/^\/wiadomosci\/api\/(outbox|sent)\/messages$/.test(path)) return send(res, 200, { data: [] });

  // Everything else (refreshToken, TokenInfo, wiadomosci2/3 visits) just needs a 200.
  if (path.startsWith('/synergia/') && !path.includes('/gateway/')) return send(res, 200, '<html></html>', 'text/html');
  return send(res, 200, {});
});

server.listen(PORT, () => console.log(`mock Librus on http://localhost:${PORT}`));
