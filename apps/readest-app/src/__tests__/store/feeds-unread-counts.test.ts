import { beforeEach, describe, expect, test } from 'vitest';
import { useFeedsStore } from '@/store/feedsStore';
import type { FreshRSSArticle, FreshRSSFeed, FreshRSSFolder } from '@/types/freshrss';

/**
 * FORK: FreshRSS only reports unread counts on a full folder/feed refresh, so
 * the sidebar numbers drifted the moment you read anything. The store now keeps
 * them honest locally as articles leave (or come back to) the queue.
 */

const folder = (id: string, unreadCount: number): FreshRSSFolder =>
  ({ id, label: id, unreadCount }) as FreshRSSFolder;
const feed = (id: string, folderId: string | null, unreadCount: number): FreshRSSFeed =>
  ({ id, title: id, folderId, unreadCount }) as FreshRSSFeed;
const article = (id: string, feedId: string, publishedAt = 0): FreshRSSArticle =>
  ({
    id,
    title: id,
    contentHtml: '',
    summaryHtml: '',
    url: '',
    publishedAt,
    feedId,
    feedTitle: feedId,
    categories: [],
  }) as unknown as FreshRSSArticle;

const seed = () =>
  useFeedsStore.setState({
    folders: [folder('folder/news', 5)],
    feeds: [feed('feed/a', 'folder/news', 3), feed('feed/b', null, 2)],
    articles: [article('x', 'feed/a', 200), article('y', 'feed/a', 100), article('z', 'feed/b')],
    currentStreamId: 'folder/news',
    currentTitle: 'News',
    continuation: undefined,
    loading: false,
    error: undefined,
    openArticles: {},
    openArticlesHydrated: true,
    summaries: {},
  });

const counts = () => {
  const s = useFeedsStore.getState();
  return {
    folder: s.folders[0]!.unreadCount,
    feedA: s.feeds.find((f) => f.id === 'feed/a')!.unreadCount,
    feedB: s.feeds.find((f) => f.id === 'feed/b')!.unreadCount,
  };
};

describe('feedsStore — unread counts follow the queue (FORK)', () => {
  beforeEach(() => {
    localStorage.clear();
    seed();
  });

  test('marking an article read decrements its feed AND its folder', () => {
    useFeedsStore.getState().removeArticleLocally('x');
    expect(counts()).toEqual({ folder: 4, feedA: 2, feedB: 2 });
  });

  test('a feed with no folder only decrements itself', () => {
    useFeedsStore.getState().removeArticleLocally('z');
    expect(counts()).toEqual({ folder: 5, feedA: 3, feedB: 1 });
  });

  test('counts never go negative', () => {
    useFeedsStore.setState({
      folders: [folder('folder/news', 0)],
      feeds: [feed('feed/a', 'folder/news', 0)],
    });
    useFeedsStore.getState().removeArticleLocally('x');
    const s = useFeedsStore.getState();
    expect(s.folders[0]!.unreadCount).toBe(0);
    expect(s.feeds[0]!.unreadCount).toBe(0);
  });

  test('removing an unknown article leaves counts alone', () => {
    useFeedsStore.getState().removeArticleLocally('nope');
    expect(counts()).toEqual({ folder: 5, feedA: 3, feedB: 2 });
  });

  test('undo restores the article in publish order and re-increments', () => {
    const removed = useFeedsStore.getState().articles.find((a) => a.id === 'y')!;
    useFeedsStore.getState().removeArticleLocally('y');
    expect(counts().feedA).toBe(2);

    useFeedsStore.getState().restoreArticleLocally(removed);
    expect(counts()).toEqual({ folder: 5, feedA: 3, feedB: 2 });
    // 'y' (publishedAt 100) sorts after 'x' (200) — back where it was, not on top.
    expect(useFeedsStore.getState().articles.map((a) => a.id)).toEqual(['x', 'y', 'z']);
  });

  test('undo is idempotent — restoring twice cannot double-count', () => {
    const removed = useFeedsStore.getState().articles.find((a) => a.id === 'y')!;
    useFeedsStore.getState().removeArticleLocally('y');
    useFeedsStore.getState().restoreArticleLocally(removed);
    useFeedsStore.getState().restoreArticleLocally(removed);
    expect(counts().feedA).toBe(3);
    expect(useFeedsStore.getState().articles.filter((a) => a.id === 'y')).toHaveLength(1);
  });

  test('mark-all-read on a folder zeroes the folder and its feeds, and clears the queue', () => {
    useFeedsStore.getState().clearStreamLocally('folder/news');
    const s = useFeedsStore.getState();
    expect(s.articles).toHaveLength(0);
    expect(s.continuation).toBeUndefined();
    expect(s.folders[0]!.unreadCount).toBe(0);
    expect(s.feeds.find((f) => f.id === 'feed/a')!.unreadCount).toBe(0);
    // A feed outside the folder is untouched.
    expect(s.feeds.find((f) => f.id === 'feed/b')!.unreadCount).toBe(2);
  });

  test('mark-all-read on a single feed leaves its folder count to the next refresh', () => {
    useFeedsStore.getState().clearStreamLocally('feed/b');
    const s = useFeedsStore.getState();
    expect(s.feeds.find((f) => f.id === 'feed/b')!.unreadCount).toBe(0);
    expect(s.feeds.find((f) => f.id === 'feed/a')!.unreadCount).toBe(3);
  });
});
