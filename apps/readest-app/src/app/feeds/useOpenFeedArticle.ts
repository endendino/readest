'use client';

import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useFeedsStore } from '@/store/feedsStore';
import { navigateToReader } from '@/utils/nav';
import { articleToCachePath } from '@/services/freshrss/articleDoc';
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
    rememberOpenArticle(book.hash, article.id, currentStreamId ?? article.feedId);
    navigateToReader(router, [book.hash]);
    return true;
  };
}
