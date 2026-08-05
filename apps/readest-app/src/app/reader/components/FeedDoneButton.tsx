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
    try {
      // Export to Obsidian FIRST, so a failure surfaces before the article is
      // marked read (and thus before it leaves the queue). Only writes a note
      // when you actually highlighted something (avoids saving every finished
      // article); the note is the full article + highlights — same file/shape
      // the Obsidian save button writes, so the two paths don't clobber.
      if (fr.exportToObsidian) {
        const highlights = collectArticleHighlights(getConfig(bookKey));
        const article = useFeedsStore.getState().articles.find((a) => a.id === entry.greaderId);
        if (highlights.length > 0 && article) {
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
      }
      await new FreshRSSClient().markRead(entry.greaderId);
      // Finished: drop the remembered resume position along with the article.
      clearArticlePosition(entry.greaderId);
      useFeedsStore.getState().removeArticleLocally(entry.greaderId);
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
        message: _('Done failed: {{error}}', { error: String(e) }),
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
      className='btn btn-primary btn-circle fixed bottom-6 end-6 z-50 h-14 w-14 shadow-lg'
    >
      {busy ? <span className='loading loading-spinner' /> : <MdCheck className='h-7 w-7' />}
    </button>
  );
};
