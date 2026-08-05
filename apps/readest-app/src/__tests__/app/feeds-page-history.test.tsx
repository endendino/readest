import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

/**
 * FORK: the /feeds stream view is backed by a synthetic history entry
 * (marked '#list') so the SYSTEM back gesture walks list → folders → library
 * exactly like the header button — previously the hierarchy lived only in
 * zustand and back exited /feeds entirely (into the dead-reader stack).
 */

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => routerMock }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => ({}) }, appService: null }),
}));
vi.mock('@/services/freshrss/obsidianExport', () => ({
  pokeLocalObsidianPull: vi.fn(),
  exportFullArticle: vi.fn(),
}));
const markUnread = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/services/freshrss/greaderClient', () => ({
  FreshRSSClient: class {
    markAllRead = vi.fn(async () => {});
    markUnread = markUnread;
  },
}));

import FeedsPage from '@/app/feeds/page';
import { useFeedsStore } from '@/store/feedsStore';
import { useSettingsStore } from '@/store/settingsStore';

const seedStores = (streamId: string | null) => {
  useSettingsStore.setState({
    settings: { globalViewSettings: {}, freshrss: { enabled: true } },
  } as never);
  useFeedsStore.setState({
    folders: [],
    feeds: [],
    articles: [],
    currentStreamId: streamId,
    currentTitle: streamId ? 'Stream' : null,
    continuation: undefined,
    loading: false,
    error: undefined,
    openArticles: {},
    openArticlesHydrated: true,
    summaries: {},
    pendingUndo: null,
  } as never);
};

const resetHistoryToPlainFeeds = () => {
  // jsdom keeps one shared history per test file — normalize the current entry.
  window.history.replaceState(null, '', '/feeds');
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetHistoryToPlainFeeds();
});
afterEach(() => cleanup());

const popstate = async () =>
  act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

describe('/feeds — stream view history entry (A2)', () => {
  test('opening a stream pushes the marked entry', async () => {
    seedStores(null);
    render(<FeedsPage />);
    expect(window.location.hash).toBe('');
    await act(async () => {
      useFeedsStore.setState({ currentStreamId: 'feed/1', currentTitle: 'F' });
    });
    expect(window.location.hash).toBe('#list');
  });

  test('re-landing on an already-marked entry does not push again', async () => {
    window.history.replaceState(null, '', '/feeds#list');
    const before = window.history.length;
    seedStores('feed/1');
    render(<FeedsPage />);
    expect(window.history.length).toBe(before);
    expect(window.location.hash).toBe('#list');
  });

  test('system back (popstate) closes the stream view', async () => {
    seedStores('feed/1');
    render(<FeedsPage />);
    await popstate();
    expect(useFeedsStore.getState().currentStreamId).toBeNull();
  });

  test('popstate with no stream open leaves navigation alone', async () => {
    seedStores(null);
    render(<FeedsPage />);
    await popstate();
    expect(useFeedsStore.getState().currentStreamId).toBeNull();
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  test('header back consumes the synthetic entry instead of clearing directly', async () => {
    seedStores(null);
    render(<FeedsPage />);
    await act(async () => {
      useFeedsStore.setState({ currentStreamId: 'feed/1', currentTitle: 'F' });
    });
    expect(window.location.hash).toBe('#list');
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    screen.getByLabelText('Back').click();
    expect(backSpy).toHaveBeenCalledTimes(1);
    // The store clear comes from the popstate the real back() emits.
    expect(useFeedsStore.getState().currentStreamId).toBe('feed/1');
    await popstate();
    expect(useFeedsStore.getState().currentStreamId).toBeNull();
    backSpy.mockRestore();
  });

  test('header back outside a stream is a plain router.back()', async () => {
    seedStores(null);
    render(<FeedsPage />);
    screen.getByLabelText('Back').click();
    expect(routerMock.back).toHaveBeenCalledTimes(1);
  });

  test('a stale marked entry after reload is stripped so back is not dead', async () => {
    window.history.replaceState(null, '', '/feeds#list');
    seedStores(null); // reload: store reset to folder view
    render(<FeedsPage />);
    expect(window.location.hash).toBe('');
  });
});

describe('/feeds — undo lives in the header', () => {
  const ARTICLE = {
    id: 'a1',
    title: 'Budget approved by council',
    contentHtml: '<p>x</p>',
    url: '',
    publishedAt: 10,
    feedId: 'feed/1',
    feedTitle: 'F',
    categories: [],
  } as never;

  const seedWithUndo = () => {
    seedStores('feed/1');
    useFeedsStore.setState({ articles: [], pendingUndo: ARTICLE } as never);
  };

  test('the pending undo replaces the title rather than adding a row', () => {
    seedWithUndo();
    render(<FeedsPage />);
    expect(screen.getByText(/Marked read: Budget approved by council/)).toBeTruthy();
    expect(screen.getByText('Undo')).toBeTruthy();
    // The stream title is yielded, not stacked above/below — no extra line.
    expect(screen.queryByText('Stream')).toBeNull();
  });

  test('the title comes back once the undo window closes', () => {
    seedStores('feed/1');
    render(<FeedsPage />);
    expect(screen.getByText('Stream')).toBeTruthy();
    expect(screen.queryByText('Undo')).toBeNull();
  });

  test('Undo restores the article and un-reads it server-side', async () => {
    seedWithUndo();
    render(<FeedsPage />);
    await act(async () => {
      screen.getByText('Undo').click();
    });
    expect(useFeedsStore.getState().articles.map((a) => a.id)).toEqual(['a1']);
    expect(useFeedsStore.getState().pendingUndo).toBeNull();
    await vi.waitFor(() => expect(markUnread).toHaveBeenCalledWith('a1'));
  });

  test('the undo control sits alongside mark-all-read, not in place of it', () => {
    seedStores('feed/1');
    useFeedsStore.setState({ articles: [ARTICLE], pendingUndo: ARTICLE } as never);
    render(<FeedsPage />);
    expect(screen.getByText('Undo')).toBeTruthy();
    expect(screen.getByLabelText('Mark all read')).toBeTruthy();
  });
});
