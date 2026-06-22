'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useFeedsStore } from '@/store/feedsStore';

const snippet = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

export const ArticleList = () => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { articles, loading, error, continuation, loadMore } = useFeedsStore();
  const fr = settings.freshrss;

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
        // Phase 3 makes this row open the article (transient doc + RSVP).
        <div key={a.id} className='flex flex-col gap-1 px-4 py-3'>
          <span className='font-medium' dir='auto'>
            {a.title}
          </span>
          <span className='text-base-content/50 text-xs' dir='auto'>
            {a.feedTitle}
            {a.publishedAt ? ` · ${new Date(a.publishedAt).toLocaleDateString()}` : ''}
          </span>
          <span className='text-base-content/60 line-clamp-2 text-sm' dir='auto'>
            {snippet(a.contentHtml)}
          </span>
        </div>
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
