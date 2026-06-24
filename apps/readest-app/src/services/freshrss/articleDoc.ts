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

/**
 * Turn a FreshRSS article into an EPUB `File`. Reuses the Send-to-Readest
 * clipper pipeline: fetch + embed the article's images (via the same-origin
 * image proxy, since the web build can't fetch them cross-origin), then
 * `htmlToBook` (sanitize → valid XHTML → `buildEpub`) with language/RTL
 * detection. The body is already the full content (FreshRSS full-text), so no
 * Readability extraction is needed.
 *
 * Always attaches a synthetic cover (source favicon + name + title). Besides
 * giving the article a masthead, an explicit cover stops foliate-js from falling
 * back to the first CONTENT image as the cover (epub.js `Resources.cover`) — that
 * fallback was rendering the lead photo twice (implicit cover + inline).
 */
export async function articleToFile(article: FreshRSSArticle): Promise<File> {
  const body = article.contentHtml?.trim() || `<p>${article.title}</p>`;
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
