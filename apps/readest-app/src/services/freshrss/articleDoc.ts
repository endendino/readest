import type { FreshRSSArticle } from '@/types/freshrss';
import { htmlToBook } from '@/services/send/conversion/convertToEpub';

/**
 * Turn a FreshRSS article into an EPUB `File` for transient import. Reuses the
 * Send-to-Readest clipper pipeline (`htmlToBook`): sanitize → valid XHTML →
 * `buildEpub`, with language/RTL detection from the content. The article body
 * is already the full content (FreshRSS full-text), so no Readability
 * extraction is needed — we feed the block straight in.
 *
 * `identityKey` is the canonical URL so re-opening the same article yields a
 * stable EPUB identifier.
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
