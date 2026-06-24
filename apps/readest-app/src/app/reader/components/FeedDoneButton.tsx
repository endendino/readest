'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdCheck } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useFeedsStore } from '@/store/feedsStore';
import { FreshRSSClient } from '@/services/freshrss/greaderClient';
import { collectArticleHighlights } from '@/services/freshrss/articleHighlights';
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
  const entry = useFeedsStore((s) => s.openArticles[bookHash]);
  const [busy, setBusy] = useState(false);

  const fr = settings.freshrss;
  if (!entry || !fr?.enabled) return null;

  const onDone = async () => {
    if (busy) return;
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
          );
        }
      }
      await new FreshRSSClient().markRead(entry.greaderId);
      useFeedsStore.getState().removeArticleLocally(entry.greaderId);
      router.push('/feeds');
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        message: _('Done failed: {{error}}', { error: String(e) }),
        type: 'error',
      });
      setBusy(false);
    }
  };

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
