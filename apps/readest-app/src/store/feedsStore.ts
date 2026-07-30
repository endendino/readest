import { create } from 'zustand';
import type { FreshRSSFolder, FreshRSSFeed, FreshRSSArticle } from '@/types/freshrss';
import { FreshRSSClient } from '@/services/freshrss/greaderClient';
import {
  clearOpenArticleByGreaderId,
  loadOpenArticles,
  saveOpenArticle,
} from '@/services/freshrss/openArticleStore';
import { loadSummaries, saveSummary, type CachedSummary } from '@/services/freshrss/summaryCache';
import type { FreshRSSSettings } from '@/types/settings';

/**
 * Monotonic token for stream loads. `openStream` clears the article list and
 * then awaits; without this, two rapid switches can resolve out of order and
 * paint the FIRST stream's articles over the second's. Every async load stamps
 * a token and discards its result if a newer load has started since.
 */
let loadToken = 0;

interface FeedsState {
  folders: FreshRSSFolder[];
  feeds: FreshRSSFeed[];
  currentStreamId: string | null;
  currentTitle: string;
  articles: FreshRSSArticle[];
  continuation?: string;
  loading: boolean;
  error?: string;
  /** hash -> {greaderId, streamId} for transient article books opened in the reader. */
  openArticles: Record<string, { greaderId: string; streamId: string }>;
  /** True once the persisted mappings have been merged in (client-side only). */
  openArticlesHydrated: boolean;
  /** Merge the device's persisted hash→article mappings into the store. */
  hydrateOpenArticles: () => void;
  /**
   * articleId -> LLM-generated quick-view summary. Hydrated from (and written
   * through to) the device-local cache, so a reload no longer re-bills the
   * paid summarize route for articles already done.
   */
  summaries: Record<string, CachedSummary>;
  setSummary: (articleId: string, entry: CachedSummary) => void;
  loadFoldersAndFeeds: (s: FreshRSSSettings) => Promise<void>;
  openStream: (s: FreshRSSSettings, streamId: string, title: string) => Promise<void>;
  loadMore: (s: FreshRSSSettings) => Promise<void>;
  removeArticleLocally: (greaderId: string) => void;
  /** Put a locally-removed article back (dismiss-undo), preserving list order. */
  restoreArticleLocally: (article: FreshRSSArticle) => void;
  /** Drop every article of a stream locally (mark-all-read), zeroing its count. */
  clearStreamLocally: (streamId: string) => void;
  rememberOpenArticle: (hash: string, greaderId: string, streamId: string) => void;
  clearCurrentStream: () => void;
}

/**
 * Keep the sidebar's unread numbers honest as articles leave (or return to) the
 * queue. FreshRSS only reports counts on a full folder/feed refresh, so without
 * this the numbers drift the moment you read anything.
 * `delta` is applied to the article's feed and, through it, its folder.
 */
const applyUnreadDelta = (
  feeds: FreshRSSFeed[],
  folders: FreshRSSFolder[],
  feedId: string,
  delta: number,
): { feeds: FreshRSSFeed[]; folders: FreshRSSFolder[] } => {
  const feed = feeds.find((f) => f.id === feedId);
  if (!feed) return { feeds, folders };
  const clamp = (n: number) => Math.max(0, n + delta);
  return {
    feeds: feeds.map((f) => (f.id === feedId ? { ...f, unreadCount: clamp(f.unreadCount) } : f)),
    folders: feed.folderId
      ? folders.map((f) =>
          f.id === feed.folderId ? { ...f, unreadCount: clamp(f.unreadCount) } : f,
        )
      : folders,
  };
};

export const useFeedsStore = create<FeedsState>((set, get) => ({
  folders: [],
  feeds: [],
  currentStreamId: null,
  currentTitle: '',
  articles: [],
  loading: false,
  // Starts empty and is hydrated from localStorage on the client (see
  // `hydrateOpenArticles`) — seeding at module scope would diverge between the
  // SSR render and the client's, producing a hydration mismatch.
  openArticles: {},
  openArticlesHydrated: false,
  summaries: {},

  hydrateOpenArticles() {
    if (get().openArticlesHydrated) return;
    const persisted = loadOpenArticles();
    const persistedSummaries = loadSummaries();
    set((st) => ({
      // Anything remembered this session wins over the persisted copy.
      openArticles: { ...persisted, ...st.openArticles },
      summaries: { ...persistedSummaries, ...st.summaries },
      openArticlesHydrated: true,
    }));
  },

  setSummary(articleId, entry) {
    saveSummary(articleId, entry);
    set((st) => ({ summaries: { ...st.summaries, [articleId]: entry } }));
  },

  async loadFoldersAndFeeds(_s) {
    set({ loading: true, error: undefined });
    try {
      const { folders, feeds } = await new FreshRSSClient().listFoldersAndFeeds();
      set({ folders, feeds, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  async openStream(_s, streamId, title) {
    const token = ++loadToken;
    set({
      loading: true,
      currentStreamId: streamId,
      currentTitle: title,
      articles: [],
      continuation: undefined,
      error: undefined,
    });
    try {
      const page = await new FreshRSSClient().getUnread(streamId, 40);
      if (token !== loadToken) return; // superseded by a newer stream switch
      const feeds = get().feeds;
      const articles = page.articles.map((a) => ({
        ...a,
        feedIconUrl: feeds.find((f) => f.id === a.feedId)?.iconUrl,
      }));
      set({ articles, continuation: page.continuation, loading: false });
    } catch (e) {
      if (token !== loadToken) return;
      set({ loading: false, error: String(e) });
    }
  },

  async loadMore(_s) {
    const { currentStreamId, continuation, loading } = get();
    if (!currentStreamId || !continuation || loading) return;
    const token = ++loadToken;
    set({ loading: true });
    try {
      const page = await new FreshRSSClient().getUnread(currentStreamId, 40, continuation);
      if (token !== loadToken) return; // a stream switch happened mid-flight
      const feeds = get().feeds;
      const more = page.articles.map((a) => ({
        ...a,
        feedIconUrl: feeds.find((f) => f.id === a.feedId)?.iconUrl,
      }));
      // Append to the CURRENT list (not the one captured before awaiting) and
      // drop any duplicate ids the server may repeat across pages.
      set((st) => {
        const seen = new Set(st.articles.map((a) => a.id));
        return {
          articles: [...st.articles, ...more.filter((a) => !seen.has(a.id))],
          continuation: page.continuation,
          loading: false,
        };
      });
    } catch (e) {
      if (token !== loadToken) return;
      set({ loading: false, error: String(e) });
    }
  },

  removeArticleLocally(greaderId) {
    clearOpenArticleByGreaderId(greaderId);
    set((st) => {
      const openArticles = Object.fromEntries(
        Object.entries(st.openArticles).filter(([, v]) => v.greaderId !== greaderId),
      );
      // Capture the feed BEFORE dropping the article, so the count can follow.
      const gone = st.articles.find((a) => a.id === greaderId);
      const counts = gone
        ? applyUnreadDelta(st.feeds, st.folders, gone.feedId, -1)
        : { feeds: st.feeds, folders: st.folders };
      return {
        articles: st.articles.filter((a) => a.id !== greaderId),
        openArticles,
        ...counts,
      };
    });
  },

  restoreArticleLocally(article) {
    set((st) => {
      if (st.articles.some((a) => a.id === article.id)) return st;
      // Re-insert by publish time so an undone dismiss lands back where it was
      // rather than jumping to the top of the queue.
      const articles = [...st.articles, article].sort(
        (a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0),
      );
      return { articles, ...applyUnreadDelta(st.feeds, st.folders, article.feedId, +1) };
    });
  },

  clearStreamLocally(streamId) {
    set((st) => {
      // A stream is either a feed or a folder; zero whichever matches and, for a
      // folder, zero its feeds too.
      const isFolder = st.folders.some((f) => f.id === streamId);
      const folderFeedIds = isFolder
        ? new Set(st.feeds.filter((f) => f.folderId === streamId).map((f) => f.id))
        : new Set<string>();
      return {
        articles: [],
        continuation: undefined,
        feeds: st.feeds.map((f) =>
          f.id === streamId || folderFeedIds.has(f.id) ? { ...f, unreadCount: 0 } : f,
        ),
        folders: st.folders.map((f) => (f.id === streamId ? { ...f, unreadCount: 0 } : f)),
      };
    });
  },

  rememberOpenArticle(hash, greaderId, streamId) {
    // Persist as well as store: the reader's Done/Save buttons key off this
    // mapping, and a reload or mobile tab-kill would otherwise lose it.
    saveOpenArticle(hash, { greaderId, streamId });
    set((st) => ({ openArticles: { ...st.openArticles, [hash]: { greaderId, streamId } } }));
  },

  clearCurrentStream() {
    set({ currentStreamId: null, currentTitle: '', articles: [], continuation: undefined });
  },
}));
