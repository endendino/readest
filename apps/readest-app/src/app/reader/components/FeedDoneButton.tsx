'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdCheck } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useFeedsStore } from '@/store/feedsStore';
import { useOpenArticleEntry } from '@/app/feeds/useOpenArticleEntry';
import { useOpenFeedArticle, wasOpenedFromFeeds } from '@/app/feeds/useOpenFeedArticle';
import { useFeedShortcuts } from '@/app/feeds/useFeedShortcuts';
import { FreshRSSClient } from '@/services/freshrss/greaderClient';
import { collectArticleHighlights } from '@/services/freshrss/articleHighlights';
import { clearArticlePosition } from '@/services/freshrss/articlePositions';
import { exportFullArticle } from '@/services/freshrss/obsidianExport';
import { eventDispatcher } from '@/utils/event';

/**
 * Floating "mark read + back to queue" button, shown only while reading a
 * FreshRSS feed article (identified via feedsStore.openArticles[bookHash]).
 * Optionally exports this article's highlights to Obsidian (WebDAV) first, then
 * marks it read in FreshRSS (propagates to every client), drops it from the
 * local queue, and returns to the feed list to tap the next.
 */
export const FeedDoneButton = ({ bookKey, bookHash }: { bookKey: string; bookHash: string }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { settings } = useSettingsStore();
  const { getConfig } = useBookDataStore();
  const entry = useOpenArticleEntry(bookHash);
  const [busy, setBusy] = useState(false);
  const openFeedArticle = useOpenFeedArticle();

  const fr = settings.freshrss;
  const active = !!entry && !!fr?.enabled;

  const onDone = async ({ after }: { after: 'list' | 'next' } = { after: 'list' }) => {
    if (busy || !entry || !fr?.enabled) return;
    setBusy(true);
    const { greaderId } = entry;
    const article = useFeedsStore.getState().articles.find((a) => a.id === greaderId);
    // Snapshot the highlights now: navigation unmounts the reader and releases
    // the transient book, so the config is gone by the time the export runs.
    const highlights = fr.exportToObsidian ? collectArticleHighlights(getConfig(bookKey)) : [];

    // Server work runs in the BACKGROUND. It used to run first, in series —
    // Obsidian export, then login, token and edit-tag — so finishing an
    // article could sit for a minute with nothing on screen having changed.
    // The local queue update is authoritative for the UI; a failure surfaces
    // as a toast, the same optimistic pattern the swipe-dismiss already uses.
    const syncInBackground = async () => {
      try {
        // Only writes a note when you actually highlighted something (avoids
        // saving every finished article); the note is the full article +
        // highlights — same file/shape the Obsidian save button writes, so
        // the two paths don't clobber.
        if (fr.exportToObsidian && highlights.length > 0 && article) {
          await exportFullArticle(
            {
              title: article.title,
              author: article.author,
              url: article.url,
              publishedAt: article.publishedAt,
              categories: article.categories,
            },
            article.contentHtml,
            settings.webdav,
            highlights,
            fr.obsidianFolder,
          );
        }
        await new FreshRSSClient().markRead(greaderId);
      } catch (e) {
        // Put it back: the article is NOT read server-side, so leaving it out
        // of the queue would silently lose it.
        if (article) useFeedsStore.getState().restoreArticleLocally(article);
        eventDispatcher.dispatch('toast', {
          message: _('Done failed: {{error}}', { error: String(e) }),
          type: 'error',
        });
      }
    };

    // Finished: drop the remembered resume position along with the article.
    clearArticlePosition(greaderId);
    useFeedsStore.getState().removeArticleLocally(greaderId);
    void syncInBackground();

    try {
      // `next` keeps a reading run going: open the article now at the head of
      // the queue instead of bouncing through the list. REPLACES the current
      // reader history entry — pushing would stack a dead entry per article
      // (the transient EPUB is deleted on unmount), and Back would then walk
      // corpses into the "Unable to open book" → /library bounce. Falls back
      // to the list when the queue is empty or the import fails.
      if (after === 'next') {
        const next = useFeedsStore.getState().articles[0];
        if (next && (await openFeedArticle(next, { replace: true }))) return;
      }
      // The entry beneath this reader IS /feeds whenever the article came from
      // the feed flow, so back() returns there without growing the stack.
      // push() only as the deep-link/post-reload fallback (stack unknown).
      if (wasOpenedFromFeeds()) router.back();
      else router.push('/feeds');
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        message: _('Could not open the next article: {{error}}', { error: String(e) }),
        type: 'error',
      });
      setBusy(false);
    }
  };

  // `n` = finish this article and read the next one; `d` = finish and return to
  // the queue (same as the button). The hook is always called — React needs a
  // stable hook order — and gated by `active`.
  useFeedShortcuts(
    {
      onNextArticle: () => void onDone({ after: 'next' }),
      onDone: () => void onDone({ after: 'list' }),
    },
    active,
  );

  if (!active) return null;

  return (
    <button
      type='button'
      onClick={() => void onDone()}
      disabled={busy}
      aria-label={_('Mark read and return to feeds')}
      title={_('Mark read')}
      // Sits above the Android gesture bar rather than under it. The article's
      // own bottom margin (FEED_ARTICLE_MARGIN_BOTTOM_PX) is sized against
      // this offset so the text never runs underneath — keep the two in sync.
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)' }}
      className='btn btn-primary btn-circle fixed end-6 z-50 h-14 w-14 shadow-lg'
    >
      {busy ? <span className='loading loading-spinner' /> : <MdCheck className='h-7 w-7' />}
    </button>
  );
};
