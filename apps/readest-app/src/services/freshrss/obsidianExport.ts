import type { WebDAVSettings } from '@/types/settings';

export interface ArticleMeta {
  title: string;
  url: string;
  feedTitle: string;
  /** Epoch ms; 0 when unknown. */
  publishedAt: number;
}

export interface ArticleHighlight {
  text: string;
  note?: string;
}

/**
 * Render an article's highlights as an Obsidian-friendly markdown note: YAML
 * frontmatter (title/source/feed/date/tags) + a "## Highlights" bullet list,
 * each highlight optionally followed by its note. Returns '' when there are no
 * highlights so the caller can skip writing an empty file.
 */
export function renderArticleMarkdown(meta: ArticleMeta, highlights: ArticleHighlight[]): string {
  if (highlights.length === 0) return '';
  const date = meta.publishedAt ? new Date(meta.publishedAt).toISOString().slice(0, 10) : '';
  const frontmatter = [
    '---',
    `title: "${meta.title.split('"').join("'")}"`,
    `source: ${meta.url}`,
    `feed: "${meta.feedTitle.split('"').join("'")}"`,
    date ? `date: ${date}` : '',
    'tags: [readest, rss]',
    '---',
  ]
    .filter(Boolean)
    .join('\n');
  const body = highlights
    .map((h) => {
      const line = `- ${h.text.trim()}`;
      return h.note && h.note.trim() ? `${line}\n  - ${h.note.trim()}` : line;
    })
    .join('\n');
  return `${frontmatter}\n\n## Highlights\n\n${body}\n`;
}

/**
 * Write the article's highlights as a markdown note to the user's WebDAV server
 * under `Obsidian/Readest/` (nginx `create_full_put_path` auto-creates the
 * folders). The user points Obsidian (e.g. the remotely-save plugin) at that
 * location. No-op when there are no highlights.
 */
export async function exportArticleHighlights(
  meta: ArticleMeta,
  highlights: ArticleHighlight[],
  webdav: Pick<WebDAVSettings, 'serverUrl' | 'username' | 'password'>,
): Promise<void> {
  const markdown = renderArticleMarkdown(meta, highlights);
  if (!markdown) return;
  if (!webdav.serverUrl || !webdav.username) {
    throw new Error('WebDAV is not configured (required for Obsidian export)');
  }
  const date = meta.publishedAt ? new Date(meta.publishedAt).toISOString().slice(0, 10) : 'undated';
  const safeTitle = (meta.title || 'article').split('/').join('-').trim().slice(0, 80) || 'article';
  const base = webdav.serverUrl.replace(/\/+$/, '');
  const url = `${base}/Obsidian/Readest/${encodeURIComponent(`${date}-${safeTitle}.md`)}`;
  const auth = btoa(`${webdav.username}:${webdav.password}`);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'text/markdown; charset=utf-8' },
    body: markdown,
  });
  if (!res.ok) throw new Error(`Obsidian export failed: HTTP ${res.status}`);
}
