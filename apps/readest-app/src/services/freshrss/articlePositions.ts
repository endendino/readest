/**
 * Reading positions for feed articles, keyed by the article's STABLE GReader
 * id — not the book hash. Articles are transient books rebuilt into an EPUB on
 * every open, so their content hash drifts (masthead/CSS changes, upstream
 * edits) and the per-hash sidecar config orphans; and the reader's disk save
 * only runs on the close path, which SPA navigations (Done, Back) and mobile
 * tab kills never hit. This store fixes both: it's written continuously
 * (throttled) while reading and read back on open regardless of the hash.
 *
 * Device-local by design (localStorage): "resume where I left off on this
 * device" — article progress deliberately does not sync (see the feed-article
 * library-pollution incident for why articles stay out of the cloud).
 */

const STORAGE_KEY = 'readest_feed_article_positions';
/** Keep the most recent N articles; older entries are pruned on write. */
const MAX_ENTRIES = 200;

interface StoredPosition {
  /** CFI location within the (re)staged article EPUB. */
  location: string;
  /** Last-write time, used for pruning. */
  at: number;
}

type PositionMap = Record<string, StoredPosition>;

const load = (): PositionMap => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PositionMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const persist = (map: PositionMap): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage full / unavailable — resume is best-effort */
  }
};

export const getArticlePosition = (articleId: string): string | null => {
  if (!articleId) return null;
  return load()[articleId]?.location ?? null;
};

export const saveArticlePosition = (articleId: string, location: string): void => {
  if (!articleId || !location) return;
  const map = load();
  map[articleId] = { location, at: Date.now() };
  const ids = Object.keys(map);
  if (ids.length > MAX_ENTRIES) {
    ids
      .sort((a, b) => (map[a]!.at ?? 0) - (map[b]!.at ?? 0))
      .slice(0, ids.length - MAX_ENTRIES)
      .forEach((id) => delete map[id]);
  }
  persist(map);
};

export const clearArticlePosition = (articleId: string): void => {
  if (!articleId) return;
  const map = load();
  if (map[articleId]) {
    delete map[articleId];
    persist(map);
  }
};
