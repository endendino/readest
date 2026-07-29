import { create } from 'zustand';
import type { FreshRSSFolder, FreshRSSFeed, FreshRSSArticle } from '@/types/freshrss';
import { FreshRSSClient } from '@/services/freshrss/greaderClient';
import {
  clearOpenArticleByGreaderId,
  loadOpenArticles,
  saveOpenArticle,
} from '@/services/freshrss/openArticleStore';
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
  /** articleId -> LLM-generated quick-view summary (cached for the session). */
  summaries: Record<string, string>;
  setSummary: (articleId: string, summary: string) => void;
  loadFoldersAndFeeds: (s: FreshRSSSettings) => Promise<void>;
  openStream: (s: FreshRSSSettings, streamId: string, title: string) => Promise<void>;
  loadMore: (s: FreshRSSSettings) => Promise<void>;
  removeArticleLocally: (greaderId: string) => void;
  rememberOpenArticle: (hash: string, greaderId: string, streamId: string) => void;
  clearCurrentStream: () => void;
}

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
    set((st) => ({
      // Anything remembered this session wins over the persisted copy.
      openArticles: { ...persisted, ...st.openArticles },
      openArticlesHydrated: true,
    }));
  },

  setSummary(articleId, summary) {
    set((st) => ({ summaries: { ...st.summaries, [articleId]: summary } }));
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
      return { articles: st.articles.filter((a) => a.id !== greaderId), openArticles };
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
