'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MdArrowBack } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useFeedsStore } from '@/store/feedsStore';
import { pokeLocalObsidianPull } from '@/services/freshrss/obsidianExport';
import { FolderFeedList } from './components/FolderFeedList';
import { ArticleList } from './components/ArticleList';

/** Narrow view of AppService's protected `fs` used by the cache sweep. */
type AppFsReadDir = (path: string, base: string) => Promise<{ path: string }[]>;

export default function FeedsPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { settings, setSettings } = useSettingsStore();
  const { currentStreamId, currentTitle, clearCurrentStream, loadFoldersAndFeeds } =
    useFeedsStore();
  const fr = settings.freshrss;

  // The settings store boots EMPTY ({}) and is normally hydrated from disk by
  // the library page — Providers loads settings for its own boot work but
  // never writes them into the store. On a direct load / reload of /feeds the
  // library never mounts, so without this the page would read
  // `settings.freshrss` as undefined forever and falsely claim FreshRSS is
  // not connected. Hydrate here, exactly like the library does.
  const settingsHydrated = !!settings.globalViewSettings;
  useEffect(() => {
    if (settingsHydrated || !appService) return;
    appService
      .loadSettings()
      .then((loaded) => {
        // Re-check: the library (or a second effect run) may have hydrated
        // the store while we were reading from disk — don't clobber it.
        if (!useSettingsStore.getState().settings.globalViewSettings) {
          setSettings(loaded);
        }
      })
      .catch((e) => console.warn('feeds: settings hydration failed', e));
  }, [settingsHydrated, appService, setSettings]);

  useEffect(() => {
    if (fr?.enabled) void loadFoldersAndFeeds(fr);
  }, [fr, loadFoldersAndFeeds]);

  // Opening Feeds on the desktop nudges the local clip-puller (a loopback
  // launchd agent) so notes saved from OTHER devices (phone) get pulled into
  // the Obsidian vault now. No-op on machines without the agent.
  useEffect(() => {
    pokeLocalObsidianPull();
  }, []);

  // Sweep stale staged article files (Cache/feed-*.epub). Articles are staged
  // per open and released when the reader closes, but files from crashed
  // sessions / older builds accumulated indefinitely (190+ on long-lived
  // installs). Best-effort: any failure is ignored.
  useEffect(() => {
    if (!appService) return;
    (async () => {
      try {
        const fs = (appService as unknown as { fs: { readDir: AppFsReadDir } }).fs;
        const entries = await fs.readDir('', 'Cache');
        for (const entry of entries) {
          const name = entry.path.split('/').pop() ?? entry.path;
          if (/^feed-.*\.epub$/.test(name)) {
            await appService.deleteFile(name, 'Cache').catch(() => {});
          }
        }
      } catch {
        /* Cache dir missing or listing unsupported — nothing to sweep */
      }
    })();
  }, [appService]);

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
        {!settingsHydrated ? (
          // Settings still loading from disk — showing "not connected" here
          // would be a false negative on every direct load of this page.
          <div className='flex justify-center p-8'>
            <span className='loading loading-spinner loading-md opacity-40' />
          </div>
        ) : !fr?.enabled ? (
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
