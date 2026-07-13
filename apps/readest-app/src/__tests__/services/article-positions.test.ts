import { beforeEach, describe, expect, test } from 'vitest';
import {
  clearArticlePosition,
  getArticlePosition,
  saveArticlePosition,
} from '@/services/freshrss/articlePositions';

/**
 * FORK: feed-article resume positions are keyed by the article's stable
 * GReader id in localStorage — immune to the staged EPUB's hash drifting
 * between opens, and written continuously so SPA navigations / mobile tab
 * kills can't lose them.
 */

describe('articlePositions (FORK feed resume)', () => {
  beforeEach(() => localStorage.clear());

  test('round-trips a position by article id', () => {
    saveArticlePosition('tag:google.com,2005:reader/item/abc', 'epubcfi(/6/4!/4/2/1:120)');
    expect(getArticlePosition('tag:google.com,2005:reader/item/abc')).toBe(
      'epubcfi(/6/4!/4/2/1:120)',
    );
  });

  test('unknown id → null; empty inputs are ignored', () => {
    expect(getArticlePosition('nope')).toBeNull();
    saveArticlePosition('', 'epubcfi(x)');
    saveArticlePosition('id', '');
    expect(getArticlePosition('id')).toBeNull();
  });

  test('clearArticlePosition removes the entry', () => {
    saveArticlePosition('a1', 'epubcfi(1)');
    clearArticlePosition('a1');
    expect(getArticlePosition('a1')).toBeNull();
  });

  test('prunes oldest entries beyond the cap (200)', () => {
    for (let i = 0; i < 205; i++) saveArticlePosition(`id-${i}`, `epubcfi(${i})`);
    expect(getArticlePosition('id-0')).toBeNull(); // oldest pruned
    expect(getArticlePosition('id-204')).toBe('epubcfi(204)'); // newest kept
  });

  test('survives corrupted storage', () => {
    localStorage.setItem('readest_feed_article_positions', '{not json');
    expect(getArticlePosition('x')).toBeNull();
    saveArticlePosition('x', 'epubcfi(9)'); // rewrites cleanly
    expect(getArticlePosition('x')).toBe('epubcfi(9)');
  });
});
