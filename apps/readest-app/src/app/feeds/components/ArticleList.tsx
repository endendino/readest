'use client';

import { useRef, useState } from 'react';
import type { ReactNode, TouchEvent } from 'react';
import { MdClose, MdExpandLess, MdMenuBook, MdDeleteOutline, MdAutoAwesome } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useFeedsStore } from '@/store/feedsStore';
import { useOpenFeedArticle } from '../useOpenFeedArticle';
import type { SummaryFormat } from '@/services/freshrss/summaryCache';
import { FreshRSSClient } from '@/services/freshrss/greaderClient';
import { eventDispatcher } from '@/utils/event';
import type { FreshRSSArticle } from '@/types/freshrss';

// Named HTML entities that actually appear in feed text. The numeric branch of
// `decodeEntities` covers every other codepoint, so this only needs the common
// named ones (an unknown name passes through unchanged rather than breaking).
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  pound: '£',
  times: '×',
};

/** Decode HTML character entities (`&quot;` → `"`, `&#39;` → `'`, `&#xE9;` → `é`)
 *  without a DOM/parser — pure string transform, cheap enough for the whole list. */
const decodeEntities = (s: string): string =>
  s.includes('&')
    ? s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === '#') {
          const code =
            e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
      })
    : s;

// Strip real tags FIRST, then decode entities — so an encoded `&lt;b&gt;` becomes
// visible text `<b>` rather than being mistaken for a tag (React escapes it on render).
const stripText = (html: string): string =>
  decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

// Hebrew/Arabic and other RTL blocks. `dir='auto'` only inspects the FIRST
// strong character, so a Hebrew article whose title/blurb opens with a Latin
// brand name, acronym, or quoted English ("BBC: …") is wrongly laid out LTR.
// Decide by the MAJORITY of strong characters instead — robust for mixed
// Hebrew/English news strings.
const RTL_CHAR = /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏ]/;
const textDir = (s: string): 'rtl' | 'ltr' => {
  let rtl = 0;
  let ltr = 0;
  for (const ch of s) {
    if (RTL_CHAR.test(ch)) rtl++;
    else if (LTR_CHAR.test(ch)) ltr++;
  }
  return rtl > ltr ? 'rtl' : 'ltr';
};

const firstParagraph = (html: string) => {
  const m = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  return stripText(m ? m[1]! : html);
};

const wordCount = (a: FreshRSSArticle) => {
  const t = stripText(a.contentHtml);
  return t ? t.split(/\s+/).length : 0;
};

const QUICK_VIEW_MAX = 700;

/** Whether the feed gives this article a genuine blurb (a summary that's a real
 *  excerpt, shorter than the full content) vs. only full text. Blurb-less
 *  articles are the ones we auto-summarize with an LLM. */
const hasBlurb = (a: FreshRSSArticle) => {
  if (!a.summaryHtml) return false;
  const summary = stripText(a.summaryHtml);
  return !!summary && summary.length < stripText(a.contentHtml).length;
};

/**
 * The quick-view blurb: the feed's summary/description when it's a genuine
 * excerpt (present and shorter than the full content), otherwise the first
 * paragraph of the content. Capped so the expanded card can't balloon. An LLM
 * summary (when available) takes precedence over this — see the component.
 */
const quickViewText = (a: FreshRSSArticle) => {
  const content = stripText(a.contentHtml);
  let text = '';
  if (hasBlurb(a)) text = stripText(a.summaryHtml!);
  if (!text) text = firstParagraph(a.contentHtml) || content;
  return text.length > QUICK_VIEW_MAX ? `${text.slice(0, QUICK_VIEW_MAX).trim()}…` : text;
};

/** Ask the server to summarize an article. Sends the blurb the reader already
 *  saw so the model only adds what the blurb doesn't cover. `redundant` is true
 *  when the article adds nothing beyond the blurb. Throws on real failure
 *  (incl. 501 when SUMMARY_API_KEY isn't configured). */
const fetchSummary = async (
  a: FreshRSSArticle,
): Promise<{ summary: string; redundant: boolean; format: SummaryFormat }> => {
  const res = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: stripText(a.contentHtml), blurb: quickViewText(a) }),
  });
  const data = (await res.json().catch(() => null)) as {
    summary?: string;
    redundant?: boolean;
    format?: SummaryFormat;
    error?: string;
  } | null;
  if (!res.ok || !data) throw new Error(data?.error || `summarize ${res.status}`);
  const format: SummaryFormat = data.format === 'bullets' ? 'bullets' : 'prose';
  if (data.redundant) return { summary: '', redundant: true, format };
  if (!data.summary) throw new Error(data.error || `summarize ${res.status}`);
  return { summary: data.summary, redundant: false, format };
};

/** Render a summary: bullet digests (long articles) as a real list, short
 *  prose as a paragraph. The model is told to emit "- " lines for bullets. */
const SummaryBody = ({ summary, format }: { summary: string; format: SummaryFormat }) => {
  if (format !== 'bullets') return <>{summary}</>;
  const items = summary
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
  if (items.length < 2) return <>{summary}</>;
  return (
    <ul className='list-disc space-y-1 ps-5'>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
};

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
  const { articles, loading, error, continuation, loadMore, removeArticleLocally } =
    useFeedsStore();
  const { summaries, setSummary } = useFeedsStore();
  const openFeedArticle = useOpenFeedArticle();
  const [opening, setOpening] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState<Set<string>>(new Set());
  // Articles whose summary came back "nothing to add beyond the blurb".
  const [noAdd, setNoAdd] = useState<Set<string>>(new Set());
  const fr = settings.freshrss;

  // Generate (or regenerate) the LLM summary for an article. `silent` suppresses
  // the error toast — used for the auto path so a blurb-less article that can't
  // be summarized just keeps its first-paragraph fallback.
  const runSummary = async (a: FreshRSSArticle, silent = false) => {
    if (summarizing.has(a.id)) return;
    setSummarizing((prev) => new Set(prev).add(a.id));
    setNoAdd((prev) => {
      if (!prev.has(a.id)) return prev;
      const next = new Set(prev);
      next.delete(a.id);
      return next;
    });
    try {
      const { summary, redundant, format } = await fetchSummary(a);
      if (redundant) {
        setNoAdd((prev) => new Set(prev).add(a.id));
        // Cache the verdict too, so a reload doesn't re-ask the model only to
        // be told again that the blurb already covers it.
        setSummary(a.id, { summary: '', format, redundant: true });
      } else {
        setSummary(a.id, { summary, format });
      }
    } catch (e) {
      if (!silent) {
        eventDispatcher.dispatch('toast', {
          message: _('Summary failed: {{error}}', { error: String(e) }),
          type: 'error',
        });
      }
    } finally {
      setSummarizing((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
    }
  };

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

  // First tap on the title opens the quick view; a second tap opens the full
  // article in the reader. Summaries are NOT auto-generated — the user taps the
  // Summarize button, and the summary is added below the blurb (not a replacement).
  const onTitleClick = (a: FreshRSSArticle) => {
    if (expandedId === a.id) void openArticle(a);
    else setExpandedId(a.id);
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
    <div
      className='divide-base-200 mx-auto max-w-[600px] divide-y text-[16px] leading-[1.5]'
      style={{ fontFamily: "'Open Sans', sans-serif" }}
    >
      {articles.map((a) => {
        const expanded = expandedId === a.id;
        const wc = wordCount(a);
        // One direction per article (from the title) so the title, byline, blurb
        // and AI summary all align consistently — see textDir for why not auto.
        const dir = textDir(a.title);
        return (
          <SwipeRow key={a.id} onDismiss={() => void dismiss(a)}>
            <div className={expanded ? 'border-base-300 bg-base-200/30 border-y-2' : 'bg-base-100'}>
              <div className='flex items-stretch'>
                <button
                  type='button'
                  dir={dir}
                  onClick={() => onTitleClick(a)}
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
                      a.author,
                      a.categories.map((c) => c.split('/').join(' › ')).join(', ') || null,
                      wc ? _('{{count}} words', { count: wc.toLocaleString() }) : null,
                      a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
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
              {expanded && (
                <div className='px-4 pb-3'>
                  <p dir={dir} className='text-base-content/80 text-[15px]'>
                    {quickViewText(a)}
                  </p>
                  {summarizing.has(a.id) && (
                    <span className='text-base-content/50 mt-2 flex items-center gap-1 text-xs'>
                      <span className='loading loading-spinner loading-xs' />
                      {_('Summarizing…')}
                    </span>
                  )}
                  {summaries[a.id]?.summary && (
                    <div
                      dir={dir}
                      className='bg-base-200/70 border-primary/60 mt-2 rounded-md border-s-2 px-3 py-2'
                    >
                      <span className='text-base-content/50 mb-1 flex items-center gap-1 text-xs font-medium'>
                        <MdAutoAwesome className='h-3.5 w-3.5' />
                        {_('AI summary')}
                      </span>
                      <div dir={dir} className='text-base-content/80 text-[15px]'>
                        <SummaryBody
                          summary={summaries[a.id]!.summary}
                          format={summaries[a.id]!.format}
                        />
                      </div>
                    </div>
                  )}
                  {noAdd.has(a.id) && !summaries[a.id] && (
                    <span className='text-base-content/50 mt-2 flex items-center gap-1 text-xs'>
                      <MdAutoAwesome className='h-3.5 w-3.5' />
                      {_('The blurb already covers it — nothing to add.')}
                    </span>
                  )}
                  <div className='mt-3 flex items-center justify-center gap-2'>
                    <button
                      type='button'
                      onClick={() => setExpandedId(null)}
                      className='btn btn-ghost btn-sm gap-1'
                    >
                      <MdExpandLess className='h-5 w-5' />
                      {_('Fold')}
                    </button>
                    <button
                      type='button'
                      onClick={() => void runSummary(a)}
                      disabled={summarizing.has(a.id)}
                      className='btn btn-ghost btn-sm gap-1'
                    >
                      <MdAutoAwesome className='h-5 w-5' />
                      {_('Summarize')}
                    </button>
                    <button
                      type='button'
                      onClick={() => void openArticle(a)}
                      disabled={opening !== null}
                      className='btn btn-ghost btn-sm text-primary gap-1'
                    >
                      <MdMenuBook className='h-5 w-5' />
                      {_('Read')}
                    </button>
                    <button
                      type='button'
                      onClick={() => void dismiss(a)}
                      className='btn btn-ghost btn-sm hover:text-error gap-1'
                    >
                      <MdDeleteOutline className='h-5 w-5' />
                      {_('Delete')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </SwipeRow>
        );
      })}
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
