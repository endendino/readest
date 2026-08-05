import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * FORK: leanness guards for the feed queue. These assert the PROPERTIES the
 * Phase C work bought, not its implementation details:
 *
 *   - derived per-article string work (word count, RTL direction, blurb, date)
 *     happens once per queue change, not per row per render, and NOT again on
 *     every search keystroke;
 *   - moving the keyboard selection re-renders the rows that changed, not all
 *     of them.
 *
 * Both regressed silently before — the list stayed correct, just slower — so
 * without these there is nothing to notice a reversion.
 */

const markRead = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/freshrss/greaderClient', () => ({
  FreshRSSClient: class {
    markRead = markRead;
    markUnread = vi.fn().mockResolvedValue(undefined);
  },
}));
// Stable across renders, exactly like the real hook — a fresh function per
// render would itself defeat the memoized rows and make this test lie.
const openFeedArticle = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@/app/feeds/useOpenFeedArticle', () => ({
  useOpenFeedArticle: () => openFeedArticle,
}));

import { ArticleList } from '@/app/feeds/components/ArticleList';
import { useFeedsStore } from '@/store/feedsStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { FreshRSSArticle } from '@/types/freshrss';
import type { SystemSettings } from '@/types/settings';

/**
 * Two probes on each article:
 *  - `contentHtml` counts DERIVATION (word count, blurb, search blob all read it);
 *  - `title` counts ROW RENDERS — after mount the derived data is cached, so
 *    further title reads come from a row actually re-rendering.
 */
const makeArticle = (
  id: string,
  title: string,
  derive: { n: number },
  renders: { n: number },
): FreshRSSArticle => {
  const body = `<p>${title} body text with several words in it</p>`;
  return {
    id,
    get title() {
      renders.n += 1;
      return title;
    },
    get contentHtml() {
      derive.n += 1;
      return body;
    },
    summaryHtml: '',
    url: `https://example.com/${id}`,
    publishedAt: 1000 - Number(id.slice(1)),
    feedId: 'feed/a',
    feedTitle: 'Feed A',
    author: 'Author',
    categories: [],
  } as unknown as FreshRSSArticle;
};

const seed = (n: number, counter: { n: number }, renders = { n: 0 }) => {
  const articles = Array.from({ length: n }, (_, i) =>
    makeArticle(`a${i}`, `Article ${i}`, counter, renders),
  );
  useSettingsStore.setState({
    settings: { freshrss: { enabled: true } } as unknown as SystemSettings,
  });
  useFeedsStore.setState({
    folders: [],
    feeds: [{ id: 'feed/a', title: 'Feed A', folderId: null, unreadCount: n }] as never,
    articles,
    currentStreamId: 'feed/a',
    currentTitle: 'Feed A',
    continuation: undefined,
    loading: false,
    error: undefined,
    openArticles: {},
    openArticlesHydrated: true,
    summaries: {},
    pendingUndo: null,
  });
  return articles;
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => cleanup());

describe('ArticleList — derived work is computed once per queue (C1)', () => {
  test('moving the selection does NOT re-derive every article', () => {
    const counter = { n: 0 };
    seed(20, counter);
    render(<ArticleList />);
    const afterMount = counter.n;
    expect(afterMount).toBeGreaterThan(0);

    // Five selection moves: previously each one re-derived all 20 articles.
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document, { key: 'j' });
    expect(counter.n).toBe(afterMount);
  });

  test('typing in the search box does NOT re-derive every article', () => {
    const counter = { n: 0 };
    seed(20, counter);
    render(<ArticleList />);
    fireEvent.keyDown(document, { key: '/' });
    const field = screen.getByLabelText('Filter articles');
    const afterOpen = counter.n;

    for (const q of ['a', 'ar', 'art', 'arti']) {
      fireEvent.change(field, { target: { value: q } });
    }
    // Search now matches a prebuilt lowercase blob.
    expect(counter.n).toBe(afterOpen);
  });

  test('expanding a row does not re-derive the queue', () => {
    const counter = { n: 0 };
    seed(15, counter);
    render(<ArticleList />);
    const before = counter.n;
    fireEvent.click(screen.getByText('Article 3'));
    expect(counter.n).toBe(before);
  });

  test('a genuinely new queue IS re-derived', () => {
    const counter = { n: 0 };
    seed(5, counter);
    const { rerender } = render(<ArticleList />);
    const before = counter.n;
    const fresh = { n: 0 };
    seed(5, fresh);
    rerender(<ArticleList />);
    // Correctness beats caching: new articles must produce new derived data.
    expect(fresh.n).toBeGreaterThan(0);
    expect(counter.n).toBe(before);
  });
});

describe('ArticleList — rows are memoized (C2)', () => {
  test('a selection move re-renders the affected rows, NOT the whole queue', () => {
    const derive = { n: 0 };
    const renders = { n: 0 };
    const N = 20;
    seed(N, derive, renders);
    render(<ArticleList />);
    renders.n = 0; // ignore mount

    const MOVES = 5;
    for (let i = 0; i < MOVES; i++) fireEvent.keyDown(document, { key: 'j' });

    // Each move repaints the row losing selection and the one gaining it.
    // Un-memoized, this is N per move (100 here) instead of ~2.
    expect(renders.n).toBeLessThan(N);
    expect(renders.n).toBeGreaterThan(0); // the selection really did move
  });

  test('selection moves keep the rest of the list rendered and correct', () => {
    const counter = { n: 0 };
    seed(10, counter);
    render(<ArticleList />);
    for (let i = 0; i < 3; i++) fireEvent.keyDown(document, { key: 'j' });
    // All rows still present and unchanged after repeated selection moves.
    expect(screen.getByText('Article 0')).toBeTruthy();
    expect(screen.getByText('Article 9')).toBeTruthy();
  });

  test('search still filters correctly through the memoized rows', () => {
    const counter = { n: 0 };
    seed(12, counter);
    render(<ArticleList />);
    fireEvent.keyDown(document, { key: '/' });
    fireEvent.change(screen.getByLabelText('Filter articles'), { target: { value: 'article 1' } });
    // "Article 1", "Article 10" and "Article 11" match; "Article 2" must not.
    expect(screen.getByText('Article 1')).toBeTruthy();
    expect(screen.getByText('Article 10')).toBeTruthy();
    expect(screen.queryByText('Article 2')).toBeNull();
  });

  test('dismissing one row leaves the others intact', () => {
    const counter = { n: 0 };
    seed(6, counter);
    render(<ArticleList />);
    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'd' });
    expect(screen.queryByText('Article 0')).toBeNull();
    expect(screen.getByText('Article 1')).toBeTruthy();
    expect(screen.getByText('Article 5')).toBeTruthy();
  });
});
