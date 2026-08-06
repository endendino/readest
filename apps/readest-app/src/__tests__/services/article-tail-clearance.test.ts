import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * FORK: the floating Done / Obsidian buttons are fixed overlays OUTSIDE the
 * viewer iframe, so without deliberate clearance they cover the closing lines
 * of an article on a phone.
 *
 * This file exists because the FIRST attempt at that clearance was a silent
 * no-op, and the test written for it only proved a config value had been set:
 *
 *   - `viewSettings.marginBottomPx` does nothing here. foliate's `scrolled()`
 *     layout applies marginBottom as padding ONLY in vertical writing mode
 *     (paginator.js) — for an ordinary horizontal article it becomes a CSS
 *     variable nothing reads.
 *   - a `<div>` spacer does nothing either: the sanitizer strips divs, leaving
 *     bare text behind.
 *
 * So these assert the clearance survives the REAL pipeline — the actual
 * sanitizer, and the actual stylesheet shipped inside the EPUB.
 */

const bundleAssets = vi.hoisted(() => vi.fn());
const htmlToBook = vi.hoisted(() =>
  vi.fn(async (..._args: [string, string, string, string, unknown, string?]) => ({
    file: new File(['x'], 'a.epub'),
  })),
);
vi.mock('@/services/send/conversion/assetBundler', () => ({ bundleAssets }));
vi.mock('@/services/send/conversion/convertToEpub', () => ({ htmlToBook }));
vi.mock('@/services/send/conversion/coverGenerator', () => ({
  generateCoverSvg: vi.fn(() => '<svg/>'),
}));

import fs from 'node:fs';
import path from 'node:path';
import { ARTICLE_TAIL, articleToFile } from '@/services/freshrss/articleDoc';
import { sanitizeHtml } from '@/utils/sanitize';
import type { FreshRSSArticle } from '@/types/freshrss';

// The EPUB stylesheet is a module-private const upstream; read the source
// rather than widening the fork's patch surface just to export it.
const EPUB_BASE_CSS = fs.readFileSync(
  path.join(process.cwd(), 'src/services/send/conversion/buildEpub.ts'),
  'utf8',
);

const article = (over: Partial<FreshRSSArticle> = {}): FreshRSSArticle =>
  ({
    id: 'a1',
    title: 'Headline',
    contentHtml: '<p>First line.</p><p>The very last line of the article.</p>',
    summaryHtml: '',
    url: 'https://news.example.com/a',
    publishedAt: 0,
    feedId: 'f',
    feedTitle: 'News',
    categories: [],
    ...over,
  }) as unknown as FreshRSSArticle;

/** The document body handed to the conversion pipeline. */
const buildBody = async (over: Partial<FreshRSSArticle> = {}) => {
  await articleToFile(article(over));
  return String(bundleAssets.mock.calls.at(-1)![0]);
};

beforeEach(() => {
  vi.clearAllMocks();
  bundleAssets.mockImplementation(async (html: string) => ({ html, images: [], missing: 0 }));
  htmlToBook.mockResolvedValue({ file: new File(['x'], 'a.epub') });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});

describe('article tail — the clearance is IN the document', () => {
  test('every article ends with the spacer, after its last paragraph', async () => {
    const body = await buildBody();
    expect(body).toContain('rss-tail');
    expect(body.indexOf('The very last line')).toBeLessThan(body.indexOf('rss-tail'));
    expect(body.trimEnd().endsWith('</p>')).toBe(true);
  });

  test('an article with no content still gets the spacer', async () => {
    const body = await buildBody({ contentHtml: '' });
    expect(body).toContain('rss-tail');
  });

  test('the spacer SURVIVES the real sanitizer, class and all', async () => {
    // The original attempt used <div>, which is stripped to bare text — the
    // exact failure this test exists to prevent.
    const sanitized = sanitizeHtml(await buildBody());
    expect(sanitized).toContain('class="rss-tail"');
  });

  test('a <div> spacer would NOT survive — proving the <p> choice is load-bearing', () => {
    const asDiv = sanitizeHtml('<p>body</p><div class="rss-tail"> </div>');
    expect(asDiv).not.toContain('rss-tail');
    const asP = sanitizeHtml(`<p>body</p>${ARTICLE_TAIL}`);
    expect(asP).toContain('rss-tail');
  });

  test('the spacer is not empty — an empty element can be dropped', () => {
    expect(ARTICLE_TAIL).toMatch(/<p class="rss-tail">\s*\S?\s*<\/p>/);
    expect(ARTICLE_TAIL.replace(/<[^>]+>/g, '').length).toBeGreaterThan(0);
  });
});

describe('article tail — the stylesheet actually gives it height', () => {
  test('the EPUB CSS sizes .rss-tail', () => {
    expect(EPUB_BASE_CSS).toContain('.rss-tail');
    const rule = EPUB_BASE_CSS.slice(EPUB_BASE_CSS.indexOf('.rss-tail'));
    const height = rule.match(/[;{\s]height:\s*(\d+)px/);
    expect(height).toBeTruthy();
    // Must clear a 56px button sitting at safe-area + 24px.
    expect(Number(height![1])).toBeGreaterThan(34 + 24 + 56);
  });

  test('the height wins over the reader-injected paragraph rules', () => {
    // The reader injects its own `p { ... !important }` layout styles, so the
    // spacer's sizing has to be !important or it collapses to a line.
    const rule = EPUB_BASE_CSS.slice(
      EPUB_BASE_CSS.indexOf('.rss-tail'),
      EPUB_BASE_CSS.indexOf('.rss-tail') + 200,
    );
    // Anchored so `line-height` cannot satisfy the `height` assertion — it
    // did on the first pass, which hid a dropped !important.
    expect(rule).toMatch(/[;{\s]height:[^;]*!important/);
    expect(rule).toMatch(/[;{\s]margin:[^;]*!important/);
  });
});
