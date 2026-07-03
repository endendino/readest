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
  if (!webdav.serverUrl) {
    throw new Error('WebDAV is not configured (required for Obsidian export)');
  }
  const date = meta.publishedAt ? new Date(meta.publishedAt).toISOString().slice(0, 10) : 'undated';
  const safeTitle = (meta.title || 'article').split('/').join('-').trim().slice(0, 80) || 'article';
  const base = webdav.serverUrl.replace(/\/+$/, '');
  const url = `${base}/Obsidian/Readest/${encodeURIComponent(`${date}-${safeTitle}.md`)}`;
  // Omit Authorization when creds are empty (proxied mode): the request is then
  // same-origin and the browser's cached app-login flows to the reverse proxy,
  // which injects the real WebDAV auth. With creds present, send them directly.
  const authHeader: Record<string, string> =
    webdav.username || webdav.password
      ? { Authorization: `Basic ${btoa(`${webdav.username}:${webdav.password}`)}` }
      : {};
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeader, 'Content-Type': 'text/markdown; charset=utf-8' },
    body: markdown,
  });
  if (!res.ok) throw new Error(`Obsidian export failed: HTTP ${res.status}`);
}

// --- full-article clip ---------------------------------------------------

export interface FullArticleMeta {
  title: string;
  author?: string;
  url: string;
  /** Epoch ms; 0 when unknown. Used for the `date` (original publish) property. */
  publishedAt: number;
  /** Folder/category label paths, mapped to tags. */
  categories?: string[];
}

const yamlEscape = (s: string) => s.split('"').join("'");

/** Minimal HTML → Markdown for the article body. Handles the common block and
 *  inline tags; unknown tags fall through to their children. Runs client-side
 *  (DOMParser). Good enough for a readable Obsidian note, not a full converter. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
  const root = doc.getElementById('r');
  if (!root)
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const nodeToMd = (node: Node): string => {
    if (node.nodeType === 3) return (node.textContent || '').replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const kids = () => Array.from(el.childNodes).map(nodeToMd).join('');
    switch (tag) {
      case 'h1':
        return `\n\n# ${kids().trim()}\n\n`;
      case 'h2':
        return `\n\n## ${kids().trim()}\n\n`;
      case 'h3':
        return `\n\n### ${kids().trim()}\n\n`;
      case 'h4':
      case 'h5':
      case 'h6':
        return `\n\n#### ${kids().trim()}\n\n`;
      case 'p':
        return `\n\n${kids().trim()}\n\n`;
      case 'br':
        return '  \n';
      case 'hr':
        return '\n\n---\n\n';
      case 'strong':
      case 'b':
        return `**${kids().trim()}**`;
      case 'em':
      case 'i':
        return `*${kids().trim()}*`;
      case 'a': {
        const href = el.getAttribute('href') || '';
        const t = kids().trim() || href;
        return href ? `[${t}](${href})` : t;
      }
      case 'img': {
        const src = el.getAttribute('src') || '';
        const alt = el.getAttribute('alt') || '';
        return src ? `\n\n![${alt}](${src})\n\n` : '';
      }
      case 'blockquote':
        return `\n\n> ${kids().trim().replace(/\n+/g, '\n> ')}\n\n`;
      case 'ul':
      case 'ol':
        return `\n\n${Array.from(el.children)
          .map((li, i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${nodeToMd(li).trim()}`)
          .join('\n')}\n\n`;
      case 'li':
        return kids().trim();
      default:
        return kids();
    }
  };

  return nodeToMd(root)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Render the highlights as a `## Highlights` bullet list (each optionally
 *  followed by its note). Empty string when there are none. */
const renderHighlightsSection = (highlights: ArticleHighlight[]): string => {
  if (highlights.length === 0) return '';
  const body = highlights
    .map((h) => {
      const line = `- ${h.text.trim()}`;
      return h.note && h.note.trim() ? `${line}\n  - ${h.note.trim()}` : line;
    })
    .join('\n');
  return `\n## Highlights\n\n${body}\n`;
};

/**
 * Render a full-article Obsidian note: YAML frontmatter (title/author/date/
 * created/source/tags) + a `# title` heading + the body as Markdown, with any
 * highlights appended as a `## Highlights` section so one note has everything.
 */
export function renderFullArticleMarkdown(
  meta: FullArticleMeta,
  html: string,
  highlights: ArticleHighlight[] = [],
): string {
  const pub = meta.publishedAt ? new Date(meta.publishedAt).toISOString().slice(0, 10) : '';
  const created = new Date().toISOString().slice(0, 10);
  const tags = ['readest', 'rss', ...(meta.categories ?? []).map((c) => c.replace(/\s+/g, '-'))];
  const frontmatter = [
    '---',
    `title: "${yamlEscape(meta.title)}"`,
    meta.author ? `author: "${yamlEscape(meta.author)}"` : '',
    pub ? `date: ${pub}` : '',
    `created: ${created}`,
    meta.url ? `source: ${meta.url}` : '',
    `tags: [${tags.join(', ')}]`,
    '---',
  ]
    .filter(Boolean)
    .join('\n');
  return `${frontmatter}\n\n# ${meta.title}\n\n${htmlToMarkdown(html)}\n${renderHighlightsSection(highlights)}`;
}

/**
 * Save the full article (+ any highlights) as a Markdown note to the user's
 * WebDAV server under `Obsidian/Readest/`, surfaced in their vault via the
 * remotely-save plugin.
 */
export async function exportFullArticle(
  meta: FullArticleMeta,
  html: string,
  webdav: Pick<WebDAVSettings, 'serverUrl' | 'username' | 'password'>,
  highlights: ArticleHighlight[] = [],
  folder = 'Obsidian/Readest',
): Promise<void> {
  if (!webdav.serverUrl) {
    throw new Error('WebDAV is not configured (required for Obsidian save)');
  }
  const date = meta.publishedAt ? new Date(meta.publishedAt).toISOString().slice(0, 10) : 'undated';
  const safeTitle = (meta.title || 'article').split('/').join('-').trim().slice(0, 80) || 'article';
  const base = webdav.serverUrl.replace(/\/+$/, '');
  // Per-segment encode so nested folders (e.g. Obsidian/personal/marginalia/Readest)
  // are preserved; nginx `create_full_put_path` auto-creates the parents on PUT.
  const folderPath = (folder || 'Obsidian/Readest')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  const url = `${base}/${folderPath}/${encodeURIComponent(`${date}-${safeTitle}.md`)}`;
  const authHeader: Record<string, string> =
    webdav.username || webdav.password
      ? { Authorization: `Basic ${btoa(`${webdav.username}:${webdav.password}`)}` }
      : {};
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeader, 'Content-Type': 'text/markdown; charset=utf-8' },
    body: renderFullArticleMarkdown(meta, html, highlights),
  });
  if (!res.ok) throw new Error(`Obsidian save failed: HTTP ${res.status}`);
}
