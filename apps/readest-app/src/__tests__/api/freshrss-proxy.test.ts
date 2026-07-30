import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { OPTIONS, POST } from '@/app/api/freshrss/route';

/**
 * FORK: the same-origin proxy to FreshRSS. It exists so the GReader credentials
 * live ONLY on the server — the browser never holds them, which is what makes
 * the feed reader work on a fresh device with no login and survive storage
 * eviction. Two properties protect that:
 *
 *   - the client supplies a RELATIVE path only, so this can never become an open
 *     proxy or leak the Authorization header to a third-party host;
 *   - credentials are injected on ClientLogin alone and are never echoed back.
 */

const SERVER = 'https://rss.example.com';
const fetchMock = vi.fn();

const post = (payload: unknown, raw?: string) =>
  POST(
    new NextRequest('http://localhost:3000/api/freshrss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ?? JSON.stringify(payload),
    }),
  );

const okRes = (text = 'ok') =>
  new Response(text, { status: 200, headers: { 'content-type': 'text/plain' } });

const calledUrl = () => String(fetchMock.mock.calls[0]![0]);
const calledInit = () => fetchMock.mock.calls[0]![1] as RequestInit;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okRes());
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('FRESHRSS_URL', SERVER);
  vi.stubEnv('FRESHRSS_USERNAME', 'reader');
  vi.stubEnv('FRESHRSS_API_PASSWORD', 'sekrit');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('/api/freshrss — configuration', () => {
  test.each([
    'FRESHRSS_URL',
    'FRESHRSS_USERNAME',
    'FRESHRSS_API_PASSWORD',
  ])('reports 501 when %s is missing, instead of failing obscurely', async (key) => {
    vi.stubEnv(key, '');
    const r = await post({ path: '/reader/api/0/tag/list' });
    expect(r.status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('OPTIONS answers the preflight', async () => {
    const r = await OPTIONS();
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-methods')).toContain('POST');
  });

  test('rejects a malformed body', async () => {
    const r = await post(null, '{not json');
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'bad json' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('/api/freshrss — path is relative-only (no open proxy)', () => {
  test.each([
    ['an absolute https url', 'https://evil.example/steal'],
    ['an absolute http url', 'http://evil.example/steal'],
    ['a protocol-relative url', '//evil.example/steal'],
    ['an embedded scheme', '/reader/https://evil.example'],
    ['parent traversal', '/reader/../../etc/passwd'],
    ['encoded-looking traversal', '/reader/..%2f..%2fetc'],
    ['a bare relative path', 'reader/api/0/tag/list'],
    ['an empty path', ''],
  ])('refuses %s', async (_label, path) => {
    const r = await post({ path });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'bad path' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('refuses a missing path', async () => {
    const r = await post({});
    expect(r.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('refuses a non-string path', async () => {
    const r = await post({ path: 42 });
    expect(r.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a legitimate path is pinned under the configured host and API entrypoint', async () => {
    await post({ path: '/reader/api/0/tag/list' });
    expect(calledUrl()).toBe(`${SERVER}/api/greader.php/reader/api/0/tag/list`);
  });

  test('a userinfo-looking path cannot move the request off-host', async () => {
    await post({ path: '/x@evil.example/y' });
    expect(new URL(calledUrl()).host).toBe('rss.example.com');
  });

  test('a trailing slash on FRESHRSS_URL does not produce a double slash', async () => {
    vi.stubEnv('FRESHRSS_URL', `${SERVER}///`);
    await post({ path: '/reader/api/0/tag/list' });
    expect(calledUrl()).toBe(`${SERVER}/api/greader.php/reader/api/0/tag/list`);
  });
});

describe('/api/freshrss — credential handling', () => {
  test('injects the server-side credentials on ClientLogin', async () => {
    await post({ path: '/accounts/ClientLogin' });
    const init = calledInit();
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('Email')).toBe('reader');
    expect(body.get('Passwd')).toBe('sekrit');
  });

  test('a client cannot override the login body to probe other accounts', async () => {
    await post({ path: '/accounts/ClientLogin', body: 'Email=admin&Passwd=guess' });
    const body = new URLSearchParams(String(calledInit().body));
    expect(body.get('Email')).toBe('reader');
    expect(body.get('Passwd')).toBe('sekrit');
  });

  test('login is forced to POST even if the client asks for GET', async () => {
    await post({ path: '/accounts/ClientLogin', method: 'GET' });
    expect(calledInit().method).toBe('POST');
  });

  test('non-login requests carry the client token and NOT the password', async () => {
    await post({ path: '/reader/api/0/tag/list', auth: 'TOKEN123' });
    const headers = new Headers(calledInit().headers);
    expect(headers.get('authorization')).toBe('GoogleLogin auth=TOKEN123');
    expect(JSON.stringify(calledInit())).not.toContain('sekrit');
  });

  test('omits Authorization entirely when no token was supplied', async () => {
    await post({ path: '/reader/api/0/tag/list' });
    expect(new Headers(calledInit().headers).has('authorization')).toBe(false);
  });

  test('forwards a POST body (e.g. mark-read) with a form content-type', async () => {
    await post({
      path: '/reader/api/0/edit-tag',
      method: 'POST',
      auth: 'T',
      body: 'i=abc&a=user/-/state/com.google/read&T=wtok',
    });
    const init = calledInit();
    expect(init.body).toContain('a=user/-/state/com.google/read');
    expect(new Headers(init.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
  });

  test('a POST with no body still sends an empty string, not undefined', async () => {
    await post({ path: '/reader/api/0/edit-tag', method: 'POST', auth: 'T' });
    expect(calledInit().body).toBe('');
  });
});

describe('/api/freshrss — response relay', () => {
  test('relays the upstream status and body verbatim', async () => {
    fetchMock.mockResolvedValue(
      new Response('Unauthorized!', { status: 401, headers: { 'content-type': 'text/plain' } }),
    );
    const r = await post({ path: '/reader/api/0/user-info', auth: 'stale' });
    expect(r.status).toBe(401);
    expect(await r.text()).toBe('Unauthorized!');
  });

  test('relays the upstream content-type so JSON stays JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"tags":[]}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const r = await post({ path: '/reader/api/0/tag/list', auth: 'T' });
    expect(r.headers.get('content-type')).toBe('application/json');
  });

  test('an unreachable server becomes a 502, not a crash', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const r = await post({ path: '/reader/api/0/tag/list', auth: 'T' });
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ error: expect.stringContaining('upstream fetch') });
  });
});
