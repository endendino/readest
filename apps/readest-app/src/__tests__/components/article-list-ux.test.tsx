import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * FORK: Phase D ergonomics for the feed queue — the things that cost taps
 * every single day: losing your place on returning from an article, a failed
 * page-load throwing the whole queue away, and rows that don't say what you've
 * already looked at or where an article came from.
 */

const markRead = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/services/freshrss/greaderClient', () => ({
  FreshRSSClient: class {
    markRead = markRead;
    markUnread = vi.fn().mockResolvedValue(undefined);
  },
}));
const openFeedArticle = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@/app/feeds/useOpenFeedArticle', () => ({
  useOpenFeedArticle: () => openFeedArticle,
}));

import { ArticleList } from '@/app/feeds/components/ArticleList';
import { useFeedsStore } from '@/store/feedsStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { FreshRSSArticle } from '@/types/freshrss';
import type { SystemSettings } from '@/types/settings';

const HOUR = 3_600_000;

const article = (id: string, title: string, over: Partial<FreshRSSArticle> = {}): FreshRSSArticle =>
  ({
    id,
    title,
    contentHtml: `<p>${title} body</p>`,
    summaryHtml: '',
    url: `https://example.com/${id}`,
    publishedAt: Date.now() - HOUR,
    feedId: 'feed/a',
    feedTitle: 'Feed A',
    author: 'Author',
    categories: [],
    ...over,
  }) as unknown as FreshRSSArticle;

const seed = (articles: FreshRSSArticle[], extra: Record<string, unknown> = {}) => {
  useSettingsStore.setState({
    settings: { freshrss: { enabled: true } } as unknown as SystemSettings,
  });
  useFeedsStore.setState({
    folders: [],
    feeds: [{ id: 'feed/a', title: 'Feed A', folderId: null, unreadCount: 3 }] as never,
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
    lastOpenedArticleId: null,
    ...extra,
  } as never);
};

const scrolled: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  scrolled.length = 0;
  // jsdom has no scrollIntoView; record which row asked to be shown.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.textContent ?? '');
  } as never;
});
afterEach(() => cleanup());

describe('D1 — returning from an article restores your place', () => {
  test('the article you came out of is selected and scrolled into view', () => {
    const articles = Array.from({ length: 12 }, (_, i) => article(`a${i}`, `Article ${i}`));
    seed(articles, { lastOpenedArticleId: 'a8' });
    render(<ArticleList />);
    expect(scrolled.some((t) => t.includes('Article 8'))).toBe(true);
  });

  test('an article that has since left the queue restores nothing (no crash)', () => {
    seed([article('a1', 'Still here')], { lastOpenedArticleId: 'gone' });
    render(<ArticleList />);
    expect(screen.getByText('Still here')).toBeTruthy();
    expect(scrolled).toHaveLength(0);
  });

  test('a fresh queue with no history does not scroll anywhere', () => {
    seed([article('a1', 'First'), article('a2', 'Second')]);
    render(<ArticleList />);
    expect(scrolled).toHaveLength(0);
  });
});

describe('D5 — rows show what you have already opened', () => {
  test('an opened article is de-emphasised; an untouched one is not', () => {
    seed([article('a1', 'Opened one'), article('a2', 'Untouched one')], {
      openArticles: { hash1: { greaderId: 'a1', streamId: 'feed/a' } },
    });
    render(<ArticleList />);
    const opened = screen.getByText('Opened one').parentElement!;
    const untouched = screen.getByText('Untouched one').parentElement!;
    expect(opened.className).toContain('text-base-content/60');
    expect(untouched.className).toContain('font-medium');
  });
});

describe('D6 — byline says when, and which feed', () => {
  test('a recent article shows its age rather than a date', () => {
    seed([article('a1', 'Recent', { publishedAt: Date.now() - 2 * HOUR })]);
    render(<ArticleList />);
    expect(screen.getByText(/\b2h\b/)).toBeTruthy();
  });

  test('minutes-old articles read in minutes', () => {
    seed([article('a1', 'Very recent', { publishedAt: Date.now() - 5 * 60_000 })]);
    render(<ArticleList />);
    expect(screen.getByText(/\b5m\b/)).toBeTruthy();
  });

  test('an old article keeps a real date', () => {
    seed([article('a1', 'Old', { publishedAt: Date.now() - 400 * HOUR })]);
    render(<ArticleList />);
    expect(screen.queryByText(/\d+h·|\d+h$/)).toBeNull();
    expect(screen.getByText(/\d{1,4}[/.-]\d{1,2}/)).toBeTruthy();
  });

  test('the feed name appears when the queue spans feeds', () => {
    seed([
      article('a1', 'From A', { feedId: 'feed/a', feedTitle: 'Feed A' }),
      article('a2', 'From B', { feedId: 'feed/b', feedTitle: 'Feed B' }),
    ]);
    render(<ArticleList />);
    expect(screen.getByText(/Feed A/)).toBeTruthy();
    expect(screen.getByText(/Feed B/)).toBeTruthy();
  });

  test('it is omitted inside a single feed — same name on every row is noise', () => {
    seed([article('a1', 'One'), article('a2', 'Two')]);
    render(<ArticleList />);
    expect(screen.queryByText(/Feed A/)).toBeNull();
  });
});

describe('D3 — a failed load does not throw the queue away', () => {
  test('an error alongside articles is an inline banner, not a takeover', () => {
    seed([article('a1', 'Kept'), article('a2', 'Also kept')], { error: 'network died' });
    render(<ArticleList />);
    expect(screen.getByText('network died')).toBeTruthy();
    // The queue survives, with a way to recover.
    expect(screen.getByText('Kept')).toBeTruthy();
    expect(screen.getByText('Also kept')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  test('an error with an EMPTY queue takes the screen, and still offers retry', () => {
    seed([], { error: 'nothing loaded' });
    render(<ArticleList />);
    expect(screen.getByText('nothing loaded')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
