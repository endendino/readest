'use client';

import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { isPWA, isWebAppPlatform } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { useFeedsStore } from '@/store/feedsStore';
import { articleToCachePath } from '@/services/freshrss/articleDoc';
import { getArticlePosition } from '@/services/freshrss/articlePositions';
import type { BookConfig } from '@/types/book';
import type { FreshRSSArticle } from '@/types/freshrss';

/**
 * True once an article has been opened from the feed flow in THIS js session.
 * FeedDoneButton uses it to decide between `router.back()` (the entry beneath
 * the reader is /feeds, so back is the stack-neutral return) and a fresh
 * `router.push('/feeds')` (deep link / post-reload, where the stack is
 * unknown). Deliberately module-scope and unpersisted: a reload invalidates
 * what we know about the history stack, and the flag resets with it.
 */
let openedFromFeeds = false;
export const wasOpenedFromFeeds = () => openedFromFeeds;
/** Test-only reset. */
export const resetOpenedFromFeeds = () => {
  openedFromFeeds = false;
};

/**
 * Mirror of upstream nav.ts navigateToReader's URL scheme, kept fork-side so
 * we can `router.replace` — upstream only pushes. Replace matters for the
 * done-and-next ('n') chain: pushing there stacks one PERMANENTLY DEAD reader
 * entry per article (the transient EPUB is deleted on unmount and swept on
 * /feeds mount), and Back then walks corpses into an "Unable to open book" →
 * /library bounce instead of returning to the feed list.
 */
const readerUrl = (hash: string): string =>
  isWebAppPlatform() && !isPWA() ? `/reader/${hash}` : `/reader?ids=${encodeURIComponent(hash)}`;

/**
 * Returns a function that opens a FreshRSS article in the reader as a transient
 * doc (staged in OPFS Cache, imported by path → never persisted to the library
 * or WebDAV-synced), records the hash→article mapping for mark-read, and
 * navigates to the reader. Shared by the feed list (tap to open) and the
 * reader's Done button (open the next article). Returns false on failure.
 *
 * `replace: true` swaps the current history entry instead of pushing — used by
 * the next-article chain so the stack stays [/library, /feeds, reader].
 */
export function useOpenFeedArticle() {
  const router = useRouter();
  const { envConfig } = useEnv();
  const rememberOpenArticle = useFeedsStore((s) => s.rememberOpenArticle);
  const currentStreamId = useFeedsStore((s) => s.currentStreamId);

  return async (article: FreshRSSArticle, opts?: { replace?: boolean }): Promise<boolean> => {
    const appService = await envConfig.getAppService();
    const path = await articleToCachePath(article, appService);
    const { library, setLibrary } = useLibraryStore.getState();
    const book = await appService.importBook(path, library, { transient: true });
    if (!book) return false;
    setLibrary(library);
    // Resume support: positions are remembered per ARTICLE id (device-local,
    // see articlePositions.ts) because the staged EPUB's hash drifts across
    // stagings. Seed the per-hash sidecar config with the remembered location
    // BEFORE the reader mounts, so the normal loadBookConfig path restores it.
    const savedLocation = getArticlePosition(article.id);
    if (savedLocation) {
      try {
        await appService.saveBookConfig(book, {
          location: savedLocation,
          updatedAt: Date.now(),
          booknotes: [],
        } as unknown as BookConfig);
      } catch {
        /* best-effort — worst case the article opens at the top */
      }
    }
    rememberOpenArticle(book.hash, article.id, currentStreamId ?? article.feedId);
    openedFromFeeds = true;
    if (opts?.replace) router.replace(readerUrl(book.hash));
    else router.push(readerUrl(book.hash));
    return true;
  };
}
