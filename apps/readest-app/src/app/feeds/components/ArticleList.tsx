'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useFeedsStore } from '@/store/feedsStore';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import { articleToFile } from '@/services/freshrss/articleDoc';
import type { FreshRSSArticle } from '@/types/freshrss';

const snippet = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

export const ArticleList = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { articles, loading, error, continuation, loadMore, currentStreamId, rememberOpenArticle } =
    useFeedsStore();
  const [opening, setOpening] = useState<string | null>(null);
  const fr = settings.freshrss;

  const openArticle = async (a: FreshRSSArticle) => {
    if (opening) return;
    setOpening(a.id);
    try {
      const appService = await envConfig.getAppService();
      const file = await articleToFile(a);
      const { library, setLibrary } = useLibraryStore.getState();
      // Transient: loaded directly, never persisted to the library or synced.
      const book = await appService.importBook(file, library, { transient: true });
      if (!book) throw new Error('import returned no book');
      // Commit to the store so the reader can resolve the book by hash
      // (mirrors the OPDS page-streaming open flow).
      setLibrary(library);
      rememberOpenArticle(book.hash, a.id, currentStreamId ?? '');
      navigateToReader(router, [book.hash]);
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        message: _('Could not open article: {{error}}', { error: String(e) }),
        type: 'error',
      });
      setOpening(null);
    }
  };

  if (loading && articles.length === 0) {
    return (
      <div className='p-8 text-center'>
        <span className='loading loading-spinner' />
      </div>
    );
  }
  if (error) {
    return <div className='text-error p-6 text-sm'>{error}</div>;
  }
  if (articles.length === 0) {
    return <div className='text-base-content/60 p-8 text-center text-sm'>{_('Queue clear ✓')}</div>;
  }

  return (
    <div className='divide-base-200 divide-y'>
      {articles.map((a) => (
        <button
          key={a.id}
          type='button'
          dir='auto'
          onClick={() => void openArticle(a)}
          disabled={opening !== null}
          className='hover:bg-base-200/50 flex w-full flex-col gap-1 px-4 py-3 text-start disabled:opacity-60'
        >
          <span className='flex items-center gap-2 font-medium'>
            {opening === a.id && <span className='loading loading-spinner loading-xs flex-shrink-0' />}
            <span>{a.title}</span>
          </span>
          <span className='text-base-content/50 text-xs'>
            {a.feedTitle}
            {a.publishedAt ? ` · ${new Date(a.publishedAt).toLocaleDateString()}` : ''}
          </span>
          <span className='text-base-content/60 line-clamp-2 text-sm'>{snippet(a.contentHtml)}</span>
        </button>
      ))}
      {continuation && (
        <button
          type='button'
          onClick={() => fr && void loadMore(fr)}
          disabled={loading}
          className='text-primary w-full px-4 py-3 text-center text-sm'
        >
          {loading ? _('Loading…') : _('Load more')}
        </button>
      )}
    </div>
  );
};
