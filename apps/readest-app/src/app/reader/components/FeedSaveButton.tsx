'use client';

import { useState } from 'react';
import { SiObsidian } from 'react-icons/si';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useFeedsStore } from '@/store/feedsStore';
import { collectArticleHighlights } from '@/services/freshrss/articleHighlights';
import { exportFullArticle } from '@/services/freshrss/obsidianExport';
import { eventDispatcher } from '@/utils/event';

/**
 * Floating "save full article to Obsidian" button, shown only while reading a
 * FreshRSS feed article. Writes the whole article (plus any highlights you made)
 * as a Markdown note (rich YAML frontmatter: title/author/date/created/source/
 * tags) to WebDAV under Obsidian/Readest/, synced into the vault by remotely-save.
 */
export const FeedSaveButton = ({ bookKey, bookHash }: { bookKey: string; bookHash: string }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getConfig } = useBookDataStore();
  const entry = useFeedsStore((s) => s.openArticles[bookHash]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const fr = settings.freshrss;
  if (!entry || !fr?.enabled) return null;

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const article = useFeedsStore.getState().articles.find((a) => a.id === entry.greaderId);
      if (!article) {
        throw new Error('article not in queue — reopen it from the feed list');
      }
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
        collectArticleHighlights(getConfig(bookKey)),
        fr.obsidianFolder,
      );
      setSaved(true);
      eventDispatcher.dispatch('toast', {
        message: _('Saved to Obsidian'),
        type: 'info',
        timeout: 2000,
      });
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        message: _('Obsidian save failed: {{error}}', { error: String(e) }),
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type='button'
      onClick={() => void onSave()}
      disabled={busy}
      aria-label={_('Save article to Obsidian')}
      title={saved ? _('Saved to Obsidian') : _('Save to Obsidian')}
      className='btn btn-circle fixed bottom-6 start-6 z-50 h-14 w-14 shadow-lg'
    >
      {busy ? (
        <span className='loading loading-spinner' />
      ) : (
        <SiObsidian className={saved ? 'text-primary h-6 w-6' : 'h-6 w-6'} />
      )}
    </button>
  );
};
