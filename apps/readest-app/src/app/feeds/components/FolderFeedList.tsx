'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useFeedsStore } from '@/store/feedsStore';

export const FolderFeedList = () => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { folders, feeds, loading, error, openStream } = useFeedsStore();
  const fr = settings.freshrss;

  const open = (streamId: string, title: string) => {
    if (fr) void openStream(fr, streamId, title);
  };

  if (loading && folders.length === 0 && feeds.length === 0) {
    return (
      <div className='p-8 text-center'>
        <span className='loading loading-spinner' />
      </div>
    );
  }
  if (error) {
    return <div className='text-error p-6 text-sm'>{error}</div>;
  }

  const uncategorized = feeds.filter((f) => !f.folderId);

  return (
    <div className='divide-base-200 divide-y'>
      {folders.map((folder) => {
        const folderFeeds = feeds.filter((f) => f.folderId === folder.id);
        return (
          <div key={folder.id}>
            <button
              type='button'
              onClick={() => open(folder.id, folder.label)}
              className='hover:bg-base-200/50 flex w-full items-center justify-between gap-3 px-4 py-3 text-left'
            >
              <span className='font-medium' dir='auto'>
                {folder.label}
              </span>
              <span className='text-base-content/60 flex-shrink-0 text-sm'>{folder.unreadCount}</span>
            </button>
            {folderFeeds.map((feed) => (
              <button
                key={feed.id}
                type='button'
                onClick={() => open(feed.id, feed.title)}
                className='hover:bg-base-200/50 flex w-full items-center justify-between gap-3 py-2 pe-4 ps-8 text-left'
              >
                <span className='min-w-0 truncate text-sm' dir='auto'>
                  {feed.title}
                </span>
                <span className='text-base-content/50 flex-shrink-0 text-xs'>{feed.unreadCount}</span>
              </button>
            ))}
          </div>
        );
      })}
      {uncategorized.length > 0 && (
        <div>
          <div className='text-base-content/50 px-4 pt-4 pb-1 text-xs font-medium uppercase'>
            {_('Uncategorized')}
          </div>
          {uncategorized.map((feed) => (
            <button
              key={feed.id}
              type='button'
              onClick={() => open(feed.id, feed.title)}
              className='hover:bg-base-200/50 flex w-full items-center justify-between gap-3 px-4 py-2 text-left'
            >
              <span className='min-w-0 truncate text-sm' dir='auto'>
                {feed.title}
              </span>
              <span className='text-base-content/50 flex-shrink-0 text-xs'>{feed.unreadCount}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
