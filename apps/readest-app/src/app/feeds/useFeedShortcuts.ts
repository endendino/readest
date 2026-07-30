'use client';

import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts for the feed queue (desktop power-use).
 *
 * Modelled on the reader's own `useBookShortcuts` pattern — a single
 * capture-phase document listener — but deliberately kept in fork-owned code so
 * upstream merges never touch it.
 *
 * Handlers are optional; an unbound key is simply ignored, so the same hook
 * serves the list (navigate + open) and the reader (next article), where only a
 * subset makes sense.
 */

export interface FeedShortcutHandlers {
  /** Move the selection down / up the queue. */
  onNext?: () => void;
  onPrev?: () => void;
  /** Open the selected article (o / Enter). */
  onOpen?: () => void;
  /** Read the NEXT article straight away (n) — skips the trip via the list. */
  onNextArticle?: () => void;
  /** Mark the selected/current article read (d). */
  onDone?: () => void;
  /** Save the selected/current article to Obsidian (s). */
  onSave?: () => void;
  /** Reload the queue (r). */
  onRefresh?: () => void;
  /** Focus the search field (/). */
  onSearch?: () => void;
  /** Summarize the selected article (a). */
  onSummarize?: () => void;
  /** Leave the current view (Escape) — clears search, then closes. */
  onEscape?: () => void;
}

/** True when the event target is a text field, so we never steal typing. */
const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
};

export const useFeedShortcuts = (handlers: FeedShortcutHandlers, enabled = true) => {
  // Keep the latest handlers in a ref so the listener is bound once and never
  // goes stale — re-binding on every render would drop keys mid-press.
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const h = ref.current;

      // `/` and Escape are meaningful even while typing is *possible*; every
      // other binding is a bare letter, so guard them behind the typing check
      // above (already done) and claim the event only when we act on it.
      const run = (fn?: () => void) => {
        if (!fn) return;
        event.preventDefault();
        event.stopPropagation();
        fn();
      };

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          run(h.onNext);
          break;
        case 'k':
        case 'ArrowUp':
          run(h.onPrev);
          break;
        case 'o':
        case 'Enter':
          run(h.onOpen);
          break;
        case 'n':
          run(h.onNextArticle);
          break;
        case 'd':
          run(h.onDone);
          break;
        case 's':
          run(h.onSave);
          break;
        case 'a':
          run(h.onSummarize);
          break;
        case 'r':
          run(h.onRefresh);
          break;
        case '/':
          run(h.onSearch);
          break;
        case 'Escape':
          run(h.onEscape);
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [enabled]);
};
