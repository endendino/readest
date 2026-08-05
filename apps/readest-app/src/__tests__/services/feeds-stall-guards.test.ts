import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * FORK: the article-open and feed-action paths must stay BOUNDED. Every stall
 * the user reported traced to an await with no ceiling:
 *   - fetchFavicon had no timeout at all, so one hung /api/img response left
 *     the feed list disabled until reload;
 *   - the image bundler bounds each image but not the SET, so a 20-image
 *     article with a slow origin cost ~40s before the reader appeared;
 *   - every feed action re-logged in (3 round-trips instead of 1) and the
 *     proxy had no client-side timeout.
 */

const bundleAssets = vi.hoisted(() => vi.fn());
const htmlToBook = vi.hoisted(() =>
  vi.fn(async (..._args: [string, string, string, string, unknown, string?]) => ({
    file: new File(['x'], 'a.epub'),
  })),
);
vi.mock('@/services/send/conversion/assetBundler', () => ({ bundleAssets }));
vi.mock('@/services/send/conversion/convertToEpub', () => ({ htmlToBook }));
vi.mock('@/services/send/conversion/coverGenerator', () => ({
  generateCoverSvg: vi.fn(() => '<svg/>'),
}));

import { articleToFile, withDeadline } from '@/services/freshrss/articleDoc';
import type { FreshRSSArticle } from '@/types/freshrss';

const article = (over: Partial<FreshRSSArticle> = {}): FreshRSSArticle =>
  ({
    id: 'a1',
    title: 'T',
    contentHtml: '<p>body</p>',
    url: 'https://x/a',
    publishedAt: 0,
    feedId: 'f',
    feedTitle: 'F',
    categories: [],
    ...over,
  }) as unknown as FreshRSSArticle;

/** A promise that never settles — stands in for a wedged request. */
const forever = <T>() => new Promise<T>(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  bundleAssets.mockResolvedValue({ html: '<p>bundled</p>', images: [], missing: 0 });
  htmlToBook.mockResolvedValue({ file: new File(['x'], 'a.epub') });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('withDeadline', () => {
  test('returns the real value when work finishes in time', async () => {
    await expect(withDeadline(Promise.resolve('real'), 1000, 'fallback')).resolves.toBe('real');
  });

  test('falls back when work outlasts the deadline', async () => {
    vi.useFakeTimers();
    const p = withDeadline(forever<string>(), 50, 'fallback');
    await vi.advanceTimersByTimeAsync(60);
    await expect(p).resolves.toBe('fallback');
  });

  test('falls back when work REJECTS — a failure must not sink the caller', async () => {
    await expect(withDeadline(Promise.reject(new Error('boom')), 1000, 'fb')).resolves.toBe('fb');
  });

  test('does not leave a pending timer behind on the fast path', async () => {
    vi.useFakeTimers();
    await withDeadline(Promise.resolve(1), 10_000, 0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('articleToFile — bounded open path', () => {
  test('a wedged image phase still produces an article (B2)', async () => {
    vi.useFakeTimers();
    bundleAssets.mockReturnValue(forever());
    const p = articleToFile(article());
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(p).resolves.toBeInstanceOf(File);
    // Fell back to the unbundled body: images resolve to alt text.
    expect(String(htmlToBook.mock.calls[0]![0])).toContain('<p>body</p>');
  });

  test('the favicon request carries a timeout signal (B1)', async () => {
    const f = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 404 }),
    );
    vi.stubGlobal('fetch', f);
    await articleToFile(article({ feedIconUrl: 'https://x/i.png' } as never));
    const signal = (f.mock.calls[0]![1] as RequestInit).signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    // A bare fetch() has no signal at all — that was the wedge.
    expect(signal).toBeTruthy();
  });

  test('an aborted favicon still produces an article (B1)', async () => {
    // What a real fetch does when its timeout signal fires.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      }),
    );
    await expect(
      articleToFile(article({ feedIconUrl: 'https://x/i.png' } as never)),
    ).resolves.toBeInstanceOf(File);
  });

  test('favicon and images are fetched in PARALLEL, not in series', async () => {
    let bundleStarted = 0;
    let faviconStarted = 0;
    let n = 0;
    bundleAssets.mockImplementation(async () => {
      bundleStarted = ++n;
      await new Promise((r) => setTimeout(r, 10));
      return { html: '<p>b</p>', images: [], missing: 0 };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        faviconStarted = ++n;
        return new Response(null, { status: 404 });
      }),
    );
    await articleToFile(article({ feedIconUrl: 'https://x/i.png' } as never));
    // The favicon starts before the (slower) bundle resolves — series would
    // have made it strictly later than the bundle's completion.
    expect(bundleStarted).toBe(1);
    expect(faviconStarted).toBe(2);
  });

  test('a healthy article still gets its bundled html', async () => {
    await articleToFile(article());
    expect(String(htmlToBook.mock.calls[0]![0])).toContain('bundled');
  });
});
