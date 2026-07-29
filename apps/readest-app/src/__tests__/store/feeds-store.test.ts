import { beforeEach, describe, expect, test, vi } from 'vitest';

const getUnread = vi.fn();
const listFoldersAndFeeds = vi.fn();
vi.mock('@/services/freshrss/greaderClient', () => ({
  FreshRSSClient: class {
    getUnread = getUnread;
    listFoldersAndFeeds = listFoldersAndFeeds;
  },
}));

import { useFeedsStore } from '@/store/feedsStore';
import { saveOpenArticle } from '@/services/freshrss/openArticleStore';
import type { FreshRSSSettings } from '@/types/settings';

const settings = {} as FreshRSSSettings;
const article = (id: string) => ({
  id,
  title: id,
  contentHtml: '',
  summaryHtml: '',
  url: '',
  publishedAt: 0,
  feedId: 'feed/1',
  feedTitle: 'f',
  categories: [],
});

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const reset = () =>
  useFeedsStore.setState({
    folders: [],
    feeds: [],
    currentStreamId: null,
    currentTitle: '',
    articles: [],
    continuation: undefined,
    loading: false,
    error: undefined,
    openArticles: {},
    openArticlesHydrated: false,
    summaries: {},
  });

describe('feedsStore — stream-switch race (FORK)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    reset();
  });

  test('a slow first stream cannot overwrite the stream opened after it', async () => {
    const slow = deferred<{ articles: unknown[]; continuation?: string }>();
    const fast = deferred<{ articles: unknown[]; continuation?: string }>();
    getUnread.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const first = useFeedsStore.getState().openStream(settings, 'feed/slow', 'Slow');
    const second = useFeedsStore.getState().openStream(settings, 'feed/fast', 'Fast');

    // The newer stream resolves first…
    fast.resolve({ articles: [article('fast-1')] });
    await second;
    expect(useFeedsStore.getState().articles.map((a) => a.id)).toEqual(['fast-1']);

    // …and the older one landing late must be discarded, not painted over it.
    slow.resolve({ articles: [article('slow-1')] });
    await first;
    expect(useFeedsStore.getState().articles.map((a) => a.id)).toEqual(['fast-1']);
    expect(useFeedsStore.getState().currentStreamId).toBe('feed/fast');
  });

  test('a stale error does not clobber the newer stream', async () => {
    const slow = deferred<never>();
    getUnread
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ articles: [article('fast-1')] });

    const first = useFeedsStore.getState().openStream(settings, 'feed/slow', 'Slow');
    await useFeedsStore.getState().openStream(settings, 'feed/fast', 'Fast');

    // Reject the superseded request; its error must not surface.
    (slow as unknown as { resolve: (v: unknown) => void }).resolve(
      Promise.reject(new Error('boom')) as unknown as never,
    );
    await first.catch(() => {});
    expect(useFeedsStore.getState().error).toBeUndefined();
    expect(useFeedsStore.getState().articles.map((a) => a.id)).toEqual(['fast-1']);
  });

  test('loadMore appends to the current list and drops duplicate ids', async () => {
    getUnread.mockResolvedValueOnce({ articles: [article('a')], continuation: 'c1' });
    await useFeedsStore.getState().openStream(settings, 'feed/1', 'F');

    getUnread.mockResolvedValueOnce({ articles: [article('a'), article('b')] });
    await useFeedsStore.getState().loadMore(settings);

    expect(useFeedsStore.getState().articles.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('feedsStore — openArticles persistence (FORK)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    reset();
  });

  test('starts empty (SSR-safe) and hydrates from storage on demand', () => {
    saveOpenArticle('h1', { greaderId: 'item/1', streamId: 'feed/1' });
    // Store was created before the write and must not read storage eagerly.
    expect(useFeedsStore.getState().openArticles['h1']).toBeUndefined();

    useFeedsStore.getState().hydrateOpenArticles();
    expect(useFeedsStore.getState().openArticles['h1']).toEqual({
      greaderId: 'item/1',
      streamId: 'feed/1',
    });
  });

  test('remembering an article persists it across a store reset', () => {
    useFeedsStore.getState().rememberOpenArticle('h2', 'item/2', 'feed/2');
    reset();
    useFeedsStore.getState().hydrateOpenArticles();
    expect(useFeedsStore.getState().openArticles['h2']?.greaderId).toBe('item/2');
  });

  test('marking an article read drops it from store and storage', () => {
    useFeedsStore.getState().rememberOpenArticle('h3', 'item/3', 'feed/3');
    useFeedsStore.getState().removeArticleLocally('item/3');
    expect(useFeedsStore.getState().openArticles['h3']).toBeUndefined();
    reset();
    useFeedsStore.getState().hydrateOpenArticles();
    expect(useFeedsStore.getState().openArticles['h3']).toBeUndefined();
  });

  test('hydration never overwrites a mapping remembered this session', () => {
    saveOpenArticle('h4', { greaderId: 'stale', streamId: 'feed/4' });
    useFeedsStore.getState().rememberOpenArticle('h4', 'fresh', 'feed/4');
    useFeedsStore.setState({ openArticlesHydrated: false });
    useFeedsStore.getState().hydrateOpenArticles();
    expect(useFeedsStore.getState().openArticles['h4']?.greaderId).toBe('fresh');
  });
});
