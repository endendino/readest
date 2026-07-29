/**
 * The hash → article mapping for feed articles opened in the reader, persisted
 * per device.
 *
 * Why persist: `FeedDoneButton` / `FeedSaveButton` render only when the open
 * book's hash maps to a known GReader article. That mapping used to live purely
 * in the (non-persisted) feeds store, so a reader reload — or a mobile browser
 * killing the tab — silently dropped it and both buttons disappeared: the
 * article could no longer be marked read or clipped without navigating back to
 * the list and reopening it.
 *
 * Same storage shape as `articlePositions.ts` (device-local localStorage,
 * LRU-pruned): this is per-device UI state, not something to sync — feed
 * articles are deliberately kept out of the cloud index (see the
 * library-pollution incident).
 */

const STORAGE_KEY = 'readest_feed_open_articles';
/** Keep the most recent N mappings; older entries are pruned on write. */
const MAX_ENTRIES = 100;

export interface OpenArticleEntry {
  greaderId: string;
  streamId: string;
}

interface StoredEntry extends OpenArticleEntry {
  /** Last-write time, used for pruning. */
  at: number;
}

type OpenArticleMap = Record<string, StoredEntry>;

const load = (): OpenArticleMap => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as OpenArticleMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const persist = (map: OpenArticleMap): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage full / unavailable — the buttons just won't survive a reload */
  }
};

/** All persisted mappings, for seeding the store on boot. */
export const loadOpenArticles = (): Record<string, OpenArticleEntry> => {
  const map = load();
  const out: Record<string, OpenArticleEntry> = {};
  for (const [hash, entry] of Object.entries(map)) {
    if (entry?.greaderId) out[hash] = { greaderId: entry.greaderId, streamId: entry.streamId };
  }
  return out;
};

export const saveOpenArticle = (hash: string, entry: OpenArticleEntry): void => {
  if (!hash || !entry?.greaderId) return;
  const map = load();
  map[hash] = { ...entry, at: Date.now() };
  const hashes = Object.keys(map);
  if (hashes.length > MAX_ENTRIES) {
    hashes
      .sort((a, b) => (map[a]!.at ?? 0) - (map[b]!.at ?? 0))
      .slice(0, hashes.length - MAX_ENTRIES)
      .forEach((h) => delete map[h]);
  }
  persist(map);
};

/** Drop the mapping(s) for an article once it's done (marked read). */
export const clearOpenArticleByGreaderId = (greaderId: string): void => {
  if (!greaderId) return;
  const map = load();
  let changed = false;
  for (const [hash, entry] of Object.entries(map)) {
    if (entry.greaderId === greaderId) {
      delete map[hash];
      changed = true;
    }
  }
  if (changed) persist(map);
};
