import type { BookConfig } from '@/types/book';
import type { ArticleHighlight } from './obsidianExport';

/**
 * Pull the user's highlights/annotations out of a (transient feed-article) book
 * config for Obsidian export. Shared by FeedSaveButton and FeedDoneButton so the
 * two export paths stay in sync.
 */
export function collectArticleHighlights(
  config: BookConfig | null | undefined,
): ArticleHighlight[] {
  return (config?.booknotes ?? [])
    .filter((n) => !n.deletedAt && (n.type === 'annotation' || n.type === 'excerpt') && !!n.text)
    .map((n) => ({ text: n.text as string, note: n.note }));
}
