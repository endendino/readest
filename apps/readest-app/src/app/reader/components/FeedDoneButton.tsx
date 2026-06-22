'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdCheck } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useFeedsStore } from '@/store/feedsStore';
import { FreshRSSClient } from '@/services/freshrss/greaderClient';
import { eventDispatcher } from '@/utils/event';

/**
 * Floating "mark read + back to queue" button, shown only while reading a
 * FreshRSS feed article (identified via feedsStore.openArticles[bookHash]).
 * Marks the article read in FreshRSS (the user's "delete" — propagates to every
 * client), drops it from the local queue, and returns to the feed list with the
 * read item gone, ready to tap the next.
 *
 * NOTE: we go back to the list rather than auto-opening the next article in
 * place, because the reader guards its init (isInitiating) and reader→reader
 * navigation does not reload. True in-place auto-advance would require swapping
 * the reader's book without a full navigation — a separate change.
 */
export const FeedDoneButton = ({ bookHash }: { bookHash: string }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { settings } = useSettingsStore();
  const entry = useFeedsStore((s) => s.openArticles[bookHash]);
  const [busy, setBusy] = useState(false);

  const fr = settings.freshrss;
  if (!entry || !fr?.enabled) return null;

  const onDone = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await new FreshRSSClient(fr).markRead(entry.greaderId);
      // TODO(Phase 5): export this article's highlights to Obsidian here.
      useFeedsStore.getState().removeArticleLocally(entry.greaderId);
      router.push('/feeds');
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        message: _('Mark-read failed: {{error}}', { error: String(e) }),
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
