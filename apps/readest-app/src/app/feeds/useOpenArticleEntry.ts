'use client';

import { useEffect } from 'react';
import { useFeedsStore } from '@/store/feedsStore';

/**
 * Resolve the feed article behind an open book, for the reader's Done and
 * Save-to-Obsidian buttons.
 *
 * The mapping is hydrated from localStorage on mount rather than at store
 * creation: seeding at module scope would make the SSR render (no
 * localStorage → empty) disagree with the client's, and these buttons render
 * conditionally on it, so React would report a hydration mismatch. Hydrating in
 * an effect means the first client paint matches the server and the buttons
 * appear a tick later — after a reload they now come back at all, which is the
 * point (previously the mapping was session-only and both buttons silently
 * vanished, leaving no way to mark the article read).
 */
export const useOpenArticleEntry = (bookHash: string) => {
  const hydrateOpenArticles = useFeedsStore((s) => s.hydrateOpenArticles);
  const entry = useFeedsStore((s) => s.openArticles[bookHash]);

  useEffect(() => {
    hydrateOpenArticles();
  }, [hydrateOpenArticles]);

  return entry;
};
