/** A GReader "tag"/category = a FreshRSS folder. */
export interface FreshRSSFolder {
  /** GReader stream id, e.g. "user/-/label/News". */
  id: string;
  /** Display label (last path segment of the stream id). */
  label: string;
  unreadCount: number;
}

/** A subscribed feed. */
export interface FreshRSSFeed {
  /** GReader stream id, e.g. "feed/https://example.com/rss". */
  id: string;
  title: string;
  /** Folder stream id this feed belongs to, or null if uncategorized. */
  folderId: string | null;
  unreadCount: number;
  iconUrl?: string;
}

/** One unread article. */
export interface FreshRSSArticle {
  /** GReader long item id (used verbatim for edit-tag / mark-read). */
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  author?: string;
  /** Canonical article URL. */
  url: string;
  /** Epoch ms. */
  publishedAt: number;
  /** Full HTML content (content > summary). May contain RTL text. */
  contentHtml: string;
}

/** Cursor for paged stream fetches. */
export interface FreshRSSPage {
  articles: FreshRSSArticle[];
  /** GReader continuation token; undefined when no more pages. */
  continuation?: string;
}
