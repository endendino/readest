import type { FreshRSSArticle } from '@/types/freshrss';
import type { AppService, FileSystem } from '@/types/system';
import { htmlToBook } from '@/services/send/conversion/convertToEpub';
import { bundleAssets } from '@/services/send/conversion/assetBundler';

/**
 * Turn a FreshRSS article into an EPUB `File`. Reuses the Send-to-Readest
 * clipper pipeline: fetch + embed the article's images (via the same-origin
 * image proxy, since the web build can't fetch them cross-origin), then
 * `htmlToBook` (sanitize → valid XHTML → `buildEpub`) with language/RTL
 * detection. The body is already the full content (FreshRSS full-text), so no
 * Readability extraction is needed.
 */
export async function articleToFile(article: FreshRSSArticle): Promise<File> {
  const body = article.contentHtml?.trim() || `<p>${article.title}</p>`;
  // useProxy routes the cross-origin image fetches through /api/img on web; on
  // Tauri the bundler hits the network directly (no CORS), ignoring the flag.
  const bundle = await bundleAssets(body, article.url || '', { useProxy: true });
  const { file } = await htmlToBook(
    bundle.html,
    article.title || '(untitled)',
    article.author || article.feedTitle || '',
    article.url || article.id,
    bundle.images,
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
