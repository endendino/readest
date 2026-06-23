'use client';

import { useRef, useState } from 'react';
import type { ReactNode, TouchEvent } from 'react';
import { MdClose } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useFeedsStore } from '@/store/feedsStore';
import { useOpenFeedArticle } from '../useOpenFeedArticle';
import { FreshRSSClient } from '@/services/freshrss/greaderClient';
import { eventDispatcher } from '@/utils/event';
import type { FreshRSSArticle } from '@/types/freshrss';

const snippet = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

const SWIPE_THRESHOLD = 80;

/** Horizontal swipe-to-dismiss wrapper (touch). `touch-action: pan-y` keeps
 *  vertical list scrolling native while we own horizontal gestures. */
const SwipeRow = ({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }) => {
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  const startY = useRef(0);
  const axis = useRef<'h' | 'v' | null>(null);
  const dragging = useRef(false);

  const onTouchStart = (e: TouchEvent) => {
    startX.current = e.touches[0]!.clientX;
    startY.current = e.touches[0]!.clientY;
    axis.current = null;
    dragging.current = true;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (startX.current === null) return;
    const ddx = e.touches[0]!.clientX - startX.current;
    const ddy = e.touches[0]!.clientY - startY.current;
    if (axis.current === null && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) {
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
    }
    if (axis.current === 'h') setDx(ddx);
  };
  const onTouchEnd = () => {
    dragging.current = false;
    if (axis.current === 'h' && Math.abs(dx) > SWIPE_THRESHOLD) {
      setDx(dx > 0 ? 700 : -700);
      window.setTimeout(onDismiss, 150);
    } else {
      setDx(0);
    }
    startX.current = null;
    axis.current = null;
  };

  return (
    <div className='bg-error/10 relative overflow-hidden'>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging.current ? 'none' : 'transform 0.2s ease-out',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const ArticleList = () => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { articles, loading, error, continuation, loadMore, removeArticleLocally } = useFeedsStore();
  const openFeedArticle = useOpenFeedArticle();
  const [opening, setOpening] = useState<string | null>(null);
  const fr = settings.freshrss;

  const openArticle = async (a: FreshRSSArticle) => {
    if (opening) return;
    setOpening(a.id);
    try {
      const ok = await openFeedArticle(a);
      if (!ok) throw new Error('import returned no book');
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        message: _('Could not open article: {{error}}', { error: String(e) }),
        type: 'error',
      });
      setOpening(null);
    }
  };

  // Dismiss without opening: drop it from the queue immediately (snappy) and
  // mark it read in FreshRSS in the background.
  const dismiss = async (a: FreshRSSArticle) => {
    removeArticleLocally(a.id);
    if (!fr) return;
    try {
      await new FreshRSSClient().markRead(a.id);
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        message: _('Mark-read failed: {{error}}', { error: String(e) }),
        type: 'error',
      });
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
        <SwipeRow key={a.id} onDismiss={() => void dismiss(a)}>
          <div className='bg-base-100 flex items-stretch'>
            <button
              type='button'
              dir='auto'
              onClick={() => void openArticle(a)}
              disabled={opening !== null}
              className='hover:bg-base-200/50 flex min-w-0 flex-1 flex-col gap-1 px-4 py-3 text-start disabled:opacity-60'
            >
              <span className='flex items-center gap-2 font-medium'>
                {opening === a.id && (
                  <span className='loading loading-spinner loading-xs flex-shrink-0' />
                )}
                <span>{a.title}</span>
              </span>
              <span className='text-base-content/50 text-xs'>
                {[
                  a.feedTitle,
                  a.author,
                  a.categories.map((c) => c.split('/').join(' › ')).join(', ') || null,
                  a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className='text-base-content/60 line-clamp-2 text-sm'>{snippet(a.contentHtml)}</span>
            </button>
            <button
              type='button'
              onClick={() => void dismiss(a)}
              aria-label={_('Mark read')}
              title={_('Mark read')}
              className='text-base-content/30 hover:text-error hidden flex-shrink-0 items-center px-3 sm:flex'
            >
              <MdClose className='h-5 w-5' />
            </button>
          </div>
        </SwipeRow>
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
