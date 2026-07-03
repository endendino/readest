'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MdArrowBack } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useFeedsStore } from '@/store/feedsStore';
import { FolderFeedList } from './components/FolderFeedList';
import { ArticleList } from './components/ArticleList';

export default function FeedsPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { settings } = useSettingsStore();
  const { currentStreamId, currentTitle, clearCurrentStream, loadFoldersAndFeeds } =
    useFeedsStore();
  const fr = settings.freshrss;

  useEffect(() => {
    if (fr?.enabled) void loadFoldersAndFeeds(fr);
  }, [fr, loadFoldersAndFeeds]);

  const onBack = () => {
    if (currentStreamId) clearCurrentStream();
    else router.back();
  };

  return (
    <div className='bg-base-100 mx-auto flex h-dvh w-full max-w-3xl flex-col'>
      <header className='border-base-200 flex items-center gap-2 border-b px-2 py-2'>
        <button
          type='button'
          onClick={onBack}
          className='btn btn-ghost btn-sm btn-circle'
          aria-label={_('Back')}
        >
          <MdArrowBack className='h-5 w-5' />
        </button>
        <h1 className='min-w-0 truncate text-lg font-semibold' dir='auto'>
          {currentStreamId ? currentTitle : _('Feeds')}
        </h1>
      </header>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {!fr?.enabled ? (
          <div className='text-base-content/60 p-6 text-sm'>
            {_('FreshRSS is not connected. Configure it in Settings → Integrations → FreshRSS.')}
          </div>
        ) : currentStreamId ? (
          <ArticleList />
        ) : (
          <FolderFeedList />
        )}
      </div>
    </div>
  );
}
