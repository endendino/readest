import type { FreshRSSArticle } from '@/types/freshrss';
import type { AppService, FileSystem } from '@/types/system';
import { htmlToBook } from '@/services/send/conversion/convertToEpub';
import { bundleAssets } from '@/services/send/conversion/assetBundler';
import { generateCoverSvg } from '@/services/send/conversion/coverGenerator';

/** Fetch the source feed's favicon (via the same-origin image proxy) for the
 *  cover avatar. Returns undefined on any failure — the cover generator then
 *  falls back to an initial-letter avatar. */
async function fetchFavicon(
  iconUrl?: string,
): Promise<{ bytes: ArrayBuffer; mime: string } | undefined> {
  if (!iconUrl) return undefined;
  try {
    const res = await fetch(`/api/img?url=${encodeURIComponent(iconUrl)}`);
    if (!res.ok) return undefined;
    const mime = (res.headers.get('content-type') || '').split(';')[0] || '';
    if (!mime.startsWith('image/')) return undefined;
    const bytes = await res.arrayBuffer();
    return bytes.byteLength ? { bytes, mime } : undefined;
  } catch {
    return undefined;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Strip a feed-injected "reading time" widget from the top of the content —
 * e.g. ynet's "⏱ 2 דקות קריאה (במהירות: 1)" line. Matched only by a stopwatch
 * emoji at the start of a block (or a bare stopwatch run followed by
 * minutes/reading words), so real prose is never touched. We render our own
 * neutral read-time in the byline instead.
 */
const stripReadingTimeWidget = (html: string): string =>
  html
    .replace(/<(p|div)\b[^>]*>\s*(?:<[^>]+>\s*)*[⏱⏲][\s\S]*?<\/\1>/giu, '')
    .replace(/[⏱⏲][^<\n]*?(?:דקות|דק['׳]|minutes?|min read)[^<\n]*/giu, '');

// Rough adult reading pace; good enough for a "N min read" estimate.
const WORDS_PER_MINUTE = 200;

/** Estimated reading time in whole minutes (min 1) from an HTML body. */
const estimateReadMinutes = (html: string): number => {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text ? text.split(' ').length : 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
};

const HEBREW_CHAR = /[֐-׿]/;

/**
 * The visible article header rendered at the top of the content: source favicon
 * + source name, the headline (`<h1>`, also the TOC anchor), and a byline
 * (author · date). The cover image only shows in the library thumbnail, never in
 * the reading view, so the header has to live in the content itself. The favicon
 * `<img>` is bundled like any other article image (fetched via /api/img). Uses
 * only sanitize-allowed tags; `<body dir="auto">` handles RTL alignment.
 */
function buildMasthead(article: FreshRSSArticle, readMinutes: number): string {
  const date = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : '';
  // `rss-source` centres the row and vertically-middles the name against the
  // logo; `rss-logo` shrinks the favicon (see buildEpub CSS).
  const logo = article.feedIconUrl
    ? `<img class="rss-logo" src="${escapeHtml(article.feedIconUrl)}" alt="" />`
    : '';
  const source = article.feedTitle ? `<strong>${escapeHtml(article.feedTitle)}</strong>` : '';
  const sourceLine = logo || source ? `<p class="rss-source">${logo}${source}</p>` : '';
  const titleLine = `<h1>${escapeHtml(article.title || '(untitled)')}</h1>`;
  // Estimated read time joins the byline. Hebrew feeds get a Hebrew label; the
  // masthead is a plain string with no i18n context, so this is a light
  // script sniff rather than a full translation.
  const isHebrew = HEBREW_CHAR.test(article.title || '') || HEBREW_CHAR.test(article.feedTitle || '');
  const readLabel =
    readMinutes > 0 ? (isHebrew ? `${readMinutes} דקות קריאה` : `${readMinutes} min read`) : '';
  const byline = [article.author, date, readLabel]
    .filter(Boolean)
    .map((s) => escapeHtml(s as string))
    .join(' · ');
  const bylineLine = byline ? `<p class="rss-byline">${byline}</p>` : '';
  return `${sourceLine}${titleLine}${bylineLine}<hr />`;
}

/**
 * Turn a FreshRSS article into an EPUB `File`. Prepends a masthead (source logo +
 * name + headline + byline), then reuses the Send-to-Readest clipper pipeline:
 * fetch + embed every image (incl. the favicon) via the same-origin image proxy,
 * then `htmlToBook` (sanitize → valid XHTML → `buildEpub`) with language/RTL
 * detection.
 *
 * Also attaches a synthetic cover (favicon + name + title) — used for the library
 * thumbnail, and an explicit cover stops foliate-js falling back to the first
 * CONTENT image as the cover (epub.js `Resources.cover`), which duplicated the
 * lead photo.
 */
export async function articleToFile(article: FreshRSSArticle): Promise<File> {
  const rawBody = stripReadingTimeWidget(
    article.contentHtml?.trim() || `<p>${escapeHtml(article.title || '')}</p>`,
  );
  const readMinutes = estimateReadMinutes(rawBody);
  const body = buildMasthead(article, readMinutes) + rawBody;
  // useProxy routes the cross-origin image fetches through /api/img on web; on
  // Tauri the bundler hits the network directly (no CORS), ignoring the flag.
  const bundle = await bundleAssets(body, article.url || '', { useProxy: true });
  const author = article.author || article.feedTitle || '';
  const favicon = await fetchFavicon(article.feedIconUrl);
  const cover = generateCoverSvg({
    title: article.title || '(untitled)',
    siteName: article.feedTitle || '',
    author,
    favicon,
  });
  const { file } = await htmlToBook(
    bundle.html,
    article.title || '(untitled)',
    author,
    article.url || article.id,
    bundle.images,
    cover,
  );
  return file;
}

/**
 * Build the article EPUB and stage it in the OPFS `Cache`, returning an absolute
 * path usable for a transient import.
 *
 * Why a path and not the File: `bookService.importBook` rejects a transient
 * `File` ("Transient import is only supported for file paths"), and on web there
 * are no native paths — content lives in OPFS. Staging in `Cache` (not `Books/`)
 * mirrors the cover-cache pattern and means the article is never persisted to
 * the library or WebDAV-synced. The path is `<cachePrefix>/<key>`, resolvable
 * with base `'None'` (how `importBook`/`bookContent` read it).
 */
export async function articleToCachePath(
  article: FreshRSSArticle,
  appService: AppService,
): Promise<string> {
  // getPrefix lives on FileSystem, which AppService keeps `protected`; reach it
  // via a narrow cast (the concrete app-service instance always has `fs`).
  const fs = (appService as AppService & { fs: FileSystem }).fs;
  const file = await articleToFile(article);
  const key = `feed-${(article.id || 'article').replace(/[^a-zA-Z0-9]/g, '_').slice(-48)}.epub`;
  const prefix = await fs.getPrefix('Cache');
  await fs.writeFile(key, 'Cache', file);
  return `${prefix}/${key}`;
}
