import { create } from 'zustand';
import type { FreshRSSFolder, FreshRSSFeed, FreshRSSArticle } from '@/types/freshrss';
import { FreshRSSClient } from '@/services/freshrss/greaderClient';
import type { FreshRSSSettings } from '@/types/settings';

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
  openArticles: {},
  summaries: {},

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
      set({ articles: page.articles, continuation: page.continuation, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  async loadMore(_s) {
    const { currentStreamId, continuation, articles, loading } = get();
    if (!currentStreamId || !continuation || loading) return;
    set({ loading: true });
    try {
      const page = await new FreshRSSClient().getUnread(currentStreamId, 40, continuation);
      set({ articles: [...articles, ...page.articles], continuation: page.continuation, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  removeArticleLocally(greaderId) {
    set((st) => ({ articles: st.articles.filter((a) => a.id !== greaderId) }));
  },

  rememberOpenArticle(hash, greaderId, streamId) {
    set((st) => ({ openArticles: { ...st.openArticles, [hash]: { greaderId, streamId } } }));
  },

  clearCurrentStream() {
    set({ currentStreamId: null, currentTitle: '', articles: [], continuation: undefined });
  },
}));
