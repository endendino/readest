import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

/**
 * FORK: back navigation through the feed flow. The old shape PUSHED at every
 * step — feeds → reader → feeds → reader… — and reader entries are permanently
 * dead (the transient EPUB is deleted on unmount), so Back walked corpses into
 * an "Unable to open book" → /library bounce on every platform. The invariant
 * under test: the stack stays [/library, /feeds(, #list), current-reader] no
 * matter how many articles are read in a run.
 */

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => routerMock }));

// Environment: web, non-PWA — the /reader/<hash> URL branch.
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWebAppPlatform: () => true,
  isPWA: () => false,
}));

const importBook = vi.fn();
const saveBookConfig = vi.fn(async (_book: unknown, _config: unknown) => {});
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ importBook, saveBookConfig }) },
    appService: null,
  }),
}));

vi.mock('@/services/freshrss/articleDoc', () => ({
  articleToCachePath: vi.fn(async () => '/cache/feed-a1.epub'),
}));

import {
  useOpenFeedArticle,
  wasOpenedFromFeeds,
  resetOpenedFromFeeds,
  FEED_ARTICLE_MARGIN_BOTTOM_PX,
} from '@/app/feeds/useOpenFeedArticle';
import { useFeedsStore } from '@/store/feedsStore';
import type { FreshRSSArticle } from '@/types/freshrss';

const ARTICLE = {
  id: 'tag:google.com,2005:reader/item/1',
  title: 'A',
  contentHtml: '<p>a</p>',
  url: 'https://x/a',
  publishedAt: 1,
  feedId: 'feed/1',
  feedTitle: 'F',
  categories: [],
} as unknown as FreshRSSArticle;

/** Harness exposing the hook's opener function. */
let open!: ReturnType<typeof useOpenFeedArticle>;
const Harness = () => {
  open = useOpenFeedArticle();
  return null;
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetOpenedFromFeeds();
  importBook.mockResolvedValue({ hash: 'abc123', title: 'A' });
  useFeedsStore.setState({
    openArticles: {},
    openArticlesHydrated: true,
    currentStreamId: 'feed/1',
  });
});
afterEach(() => cleanup());

describe('useOpenFeedArticle — history discipline (A1)', () => {
  test('a plain open PUSHES the reader entry', async () => {
    render(<Harness />);
    await act(async () => {
      expect(await open(ARTICLE)).toBe(true);
    });
    expect(routerMock.push).toHaveBeenCalledWith('/reader/abc123');
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  test('the next-article chain REPLACES instead of stacking', async () => {
    render(<Harness />);
    await act(async () => {
      await open(ARTICLE, { replace: true });
    });
    expect(routerMock.replace).toHaveBeenCalledWith('/reader/abc123');
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  test('opening marks the session as feed-originated', async () => {
    expect(wasOpenedFromFeeds()).toBe(false);
    render(<Harness />);
    await act(async () => {
      await open(ARTICLE);
    });
    expect(wasOpenedFromFeeds()).toBe(true);
  });

  test('seeds a bottom margin so the FABs never cover the closing lines', async () => {
    render(<Harness />);
    await act(async () => {
      await open(ARTICLE);
    });
    const config = saveBookConfig.mock.calls[0]![1] as {
      viewSettings?: { marginBottomPx?: number };
    };
    expect(config.viewSettings?.marginBottomPx).toBe(FEED_ARTICLE_MARGIN_BOTTOM_PX);
    // Must clear the buttons: 56px tall at safe-area + 24px, worst-case inset.
    expect(FEED_ARTICLE_MARGIN_BOTTOM_PX).toBeGreaterThan(34 + 24 + 56);
  });

  test('the margin is seeded even when there is no saved position to restore', async () => {
    render(<Harness />);
    await act(async () => {
      await open(ARTICLE);
    });
    // Previously the config was only written when a position existed, so a
    // first read got no margin at all.
    expect(saveBookConfig).toHaveBeenCalledTimes(1);
    const config = saveBookConfig.mock.calls[0]![1] as { location?: string };
    expect(config.location).toBeUndefined();
  });

  test('a failed import navigates nowhere and leaves the flag unset', async () => {
    importBook.mockResolvedValue(null);
    render(<Harness />);
    await act(async () => {
      expect(await open(ARTICLE)).toBe(false);
    });
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(wasOpenedFromFeeds()).toBe(false);
  });
});

describe('FeedDoneButton — back vs push (A1)', () => {
  const markRead = vi.fn(async () => {});

  const renderDone = async () => {
    vi.doMock('@/services/freshrss/greaderClient', () => ({
      FreshRSSClient: class {
        markRead = markRead;
      },
    }));
    vi.doMock('@/store/settingsStore', async (importOriginal) => importOriginal());
    const { FeedDoneButton } = await import('@/app/reader/components/FeedDoneButton');
    const { useSettingsStore } = await import('@/store/settingsStore');
    useSettingsStore.setState({
      settings: { freshrss: { enabled: true } },
    } as never);
    useFeedsStore.setState({
      articles: [],
      openArticles: { abc123: { greaderId: ARTICLE.id, streamId: 'feed/1' } },
      openArticlesHydrated: true,
    });
    return render(<FeedDoneButton bookKey='abc123-k' bookHash='abc123' />);
  };

  test('Done goes BACK when the article came from the feed flow', async () => {
    render(<Harness />);
    await act(async () => {
      await open(ARTICLE); // marks the session feed-originated
    });
    routerMock.push.mockClear();
    const { getByRole } = await renderDone();
    await act(async () => {
      getByRole('button').click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(routerMock.back).toHaveBeenCalledTimes(1));
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  test('Done falls back to push(/feeds) after a reload (flag unset)', async () => {
    resetOpenedFromFeeds();
    const { getByRole } = await renderDone();
    await act(async () => {
      getByRole('button').click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/feeds'));
    expect(routerMock.back).not.toHaveBeenCalled();
  });
});
