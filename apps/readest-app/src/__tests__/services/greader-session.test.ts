import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FreshRSSClient, resetFreshRSSSession } from '@/services/freshrss/greaderClient';

/**
 * FORK: every call site constructs `new FreshRSSClient()`, so per-instance auth
 * meant re-logging in for EVERY action — mark-read was ClientLogin + token +
 * edit-tag, three sequential proxied round-trips instead of one. The session is
 * now cached at module scope (credentials live server-side, so the token isn't
 * user-specific here) and re-established only when the server rejects it.
 */

const fetchMock = vi.fn();

/** Paths sent through the /api/freshrss proxy, in order. */
const paths = () =>
  fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).path as string);

const reply = (text: string, status = 200) => new Response(text, { status });

/** Default happy-path proxy: login, token, then whatever was asked for. */
const wireProxy = (handler?: (path: string) => Response) => {
  fetchMock.mockImplementation(async (_url, init) => {
    const { path } = JSON.parse(String((init as RequestInit).body)) as { path: string };
    if (path.startsWith('/accounts/ClientLogin')) return reply('SID=x\nAuth=TOKEN\n');
    if (path.startsWith('/reader/api/0/token')) return reply('WTOKEN');
    return handler?.(path) ?? reply('{}');
  });
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetFreshRSSSession();
  wireProxy();
});
afterEach(() => vi.unstubAllGlobals());

describe('FreshRSSClient — session caching (B3)', () => {
  test('the first action logs in; the second reuses the session', async () => {
    await new FreshRSSClient().markRead('a');
    expect(paths()).toEqual([
      '/accounts/ClientLogin',
      '/reader/api/0/token',
      '/reader/api/0/edit-tag',
    ]);

    fetchMock.mockClear();
    await new FreshRSSClient().markRead('b');
    // One round-trip, not three — even from a FRESH client instance.
    expect(paths()).toEqual(['/reader/api/0/edit-tag']);
  });

  test('the cache is shared across independent client instances', async () => {
    await new FreshRSSClient().markRead('a');
    fetchMock.mockClear();
    await new FreshRSSClient().markUnread('a');
    await new FreshRSSClient().markAllRead('feed/1');
    expect(paths()).toEqual(['/reader/api/0/edit-tag', '/reader/api/0/mark-all-as-read']);
  });

  test('the write token reaches the mutating calls', async () => {
    await new FreshRSSClient().markRead('item-1');
    const last = JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body));
    expect(last.body).toContain('T=WTOKEN');
    expect(last.auth).toBe('TOKEN');
  });

  test('an expired session re-logs in ONCE and the action still succeeds', async () => {
    await new FreshRSSClient().markRead('a'); // seed the cache
    fetchMock.mockClear();

    let rejectedOnce = false;
    wireProxy((path) => {
      if (path === '/reader/api/0/edit-tag' && !rejectedOnce) {
        rejectedOnce = true;
        return reply('Unauthorized!', 401);
      }
      return reply('OK');
    });

    await expect(new FreshRSSClient().markRead('b')).resolves.toBeUndefined();
    expect(paths()).toEqual([
      '/reader/api/0/edit-tag', // rejected
      '/accounts/ClientLogin', // recover
      '/reader/api/0/token',
      '/reader/api/0/edit-tag', // retried
    ]);
  });

  test('a non-auth failure is NOT retried — it surfaces', async () => {
    await new FreshRSSClient().markRead('a');
    fetchMock.mockClear();
    wireProxy((path) => (path === '/reader/api/0/edit-tag' ? reply('boom', 500) : reply('OK')));
    await expect(new FreshRSSClient().markRead('b')).rejects.toThrow();
    expect(paths()).toEqual(['/reader/api/0/edit-tag']); // no re-login storm
  });

  test('a failed LOGIN reports the configuration problem plainly', async () => {
    fetchMock.mockImplementation(async () => reply('Error=BadAuthentication', 200));
    await expect(new FreshRSSClient().markRead('a')).rejects.toThrow(/FreshRSS login failed/);
  });

  test('every proxied request is bounded by a timeout signal', async () => {
    await new FreshRSSClient().markRead('a');
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe('FreshRSSClient — folder view latency (B4)', () => {
  test('the three folder/feed reads are issued in PARALLEL', async () => {
    const started: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    fetchMock.mockImplementation(async (_url, init) => {
      const { path } = JSON.parse(String((init as RequestInit).body)) as { path: string };
      if (path.startsWith('/accounts/ClientLogin')) return reply('Auth=TOKEN\n');
      if (path.startsWith('/reader/api/0/token')) return reply('WTOKEN');
      started.push(path);
      // Hold the tag list open; parallel issue means the other two still start.
      if (path.includes('tag/list')) await gate;
      return reply('{}');
    });

    const p = new FreshRSSClient().listFoldersAndFeeds();
    await vi.waitFor(() => expect(started.length).toBe(3));
    releaseFirst();
    await p;
  });
});
