import type { FreshRSSArticle } from '@/types/freshrss';
import type { AppService, FileSystem } from '@/types/system';
import { htmlToBook } from '@/services/send/conversion/convertToEpub';

/**
 * Turn a FreshRSS article into an EPUB `File`. Reuses the Send-to-Readest
 * clipper pipeline (`htmlToBook`): sanitize → valid XHTML → `buildEpub`, with
 * language/RTL detection from the content. The body is already the full content
 * (FreshRSS full-text), so no Readability extraction is needed.
 */
export async function articleToFile(article: FreshRSSArticle): Promise<File> {
  const body = article.contentHtml?.trim() || `<p>${article.title}</p>`;
  const { file } = await htmlToBook(
    body,
    article.title || '(untitled)',
    article.author || article.feedTitle || '',
    article.url || article.id,
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
