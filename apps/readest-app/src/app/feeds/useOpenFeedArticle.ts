'use client';

import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useFeedsStore } from '@/store/feedsStore';
import { navigateToReader } from '@/utils/nav';
import { articleToCachePath } from '@/services/freshrss/articleDoc';
import { getArticlePosition } from '@/services/freshrss/articlePositions';
import type { BookConfig } from '@/types/book';
import type { FreshRSSArticle } from '@/types/freshrss';

/**
 * Returns a function that opens a FreshRSS article in the reader as a transient
 * doc (staged in OPFS Cache, imported by path → never persisted to the library
 * or WebDAV-synced), records the hash→article mapping for mark-read, and
 * navigates to the reader. Shared by the feed list (tap to open) and the
 * reader's Done button (open the next article). Returns false on failure.
 */
export function useOpenFeedArticle() {
  const router = useRouter();
  const { envConfig } = useEnv();
  const rememberOpenArticle = useFeedsStore((s) => s.rememberOpenArticle);
  const currentStreamId = useFeedsStore((s) => s.currentStreamId);

  return async (article: FreshRSSArticle): Promise<boolean> => {
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
    navigateToReader(router, [book.hash]);
    return true;
  };
}
