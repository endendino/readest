import { beforeEach, describe, expect, test } from 'vitest';
import { countWords, fitToBudget, summaryShapeFor } from '@/app/api/summarize/route';
import {
  SUMMARY_PROMPT_VERSION,
  loadSummaries,
  saveSummary,
} from '@/services/freshrss/summaryCache';

/**
 * FORK: summaries used to be length-blind in BOTH directions — the article was
 * truncated to 6,000 chars before the model saw it (an 8,000-word feature was
 * summarized from its first ~12%), and the ask was hard-coded to "1–2
 * sentences" with a fixed token budget. Coverage now scales with length.
 */

describe('summary length banding (FORK)', () => {
  test('short articles stay a one-or-two sentence blurb', () => {
    const shape = summaryShapeFor(300);
    expect(shape.format).toBe('prose');
    expect(shape.instruction).toContain('1–2 sentences');
  });

  test('medium articles get more prose', () => {
    expect(summaryShapeFor(1200).instruction).toContain('3–4 sentences');
    expect(summaryShapeFor(1200).format).toBe('prose');
  });

  test('long articles switch to a bulleted digest', () => {
    expect(summaryShapeFor(3000).format).toBe('bullets');
    expect(summaryShapeFor(8000).format).toBe('bullets');
  });

  test('coverage grows with length but SUB-linearly', () => {
    const short = summaryShapeFor(500);
    const long = summaryShapeFor(8000); // 16x the words
    expect(long.maxTokens).toBeGreaterThan(short.maxTokens);
    // …but nowhere near 16x — the digest gets fuller, not proportionally longer.
    expect(long.maxTokens).toBeLessThan(short.maxTokens * 16);
  });

  test('band boundaries are monotonic', () => {
    const sizes = [100, 599, 600, 1999, 2000, 4999, 5000, 20000];
    const tokens = sizes.map((n) => summaryShapeFor(n).maxTokens);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i]!).toBeGreaterThanOrEqual(tokens[i - 1]!);
    }
  });
});

describe('input budget (FORK)', () => {
  test('an article that fits is passed through untouched', () => {
    const text = 'word '.repeat(100).trim();
    expect(fitToBudget(text, 10_000)).toBe(text);
  });

  test('an oversized article keeps BOTH its opening and its ending', () => {
    const head = 'A'.repeat(5_000);
    const tail = 'Z'.repeat(5_000);
    const out = fitToBudget(head + tail, 1_000);
    expect(out.startsWith('A')).toBe(true);
    expect(out.endsWith('Z')).toBe(true); // head-only truncation lost this
    expect(out).toContain('[…]');
    expect(out.length).toBeLessThan(1_100);
  });

  test('a realistic 8,000-word article is no longer gutted', () => {
    // The old cap was 6,000 chars; such an article is ~48,000 chars.
    const article = 'word '.repeat(8_000);
    expect(countWords(article)).toBe(8_000);
    expect(fitToBudget(article, 200_000)).toBe(article); // fully seen now
  });
});

describe('summary cache (FORK)', () => {
  beforeEach(() => localStorage.clear());

  test('round-trips summary + format', () => {
    saveSummary('a1', { summary: '- one\n- two', format: 'bullets' });
    expect(loadSummaries()['a1']).toEqual({
      summary: '- one\n- two',
      format: 'bullets',
      redundant: undefined,
    });
  });

  test('caches the "adds nothing beyond the blurb" verdict too', () => {
    saveSummary('a2', { summary: '', format: 'prose', redundant: true });
    expect(loadSummaries()['a2']?.redundant).toBe(true);
  });

  test('entries from an older prompt version are ignored', () => {
    saveSummary('a3', { summary: 'old', format: 'prose' });
    const raw = JSON.parse(localStorage.getItem('readest_feed_summaries')!);
    raw['a3'].v = SUMMARY_PROMPT_VERSION - 1;
    localStorage.setItem('readest_feed_summaries', JSON.stringify(raw));
    expect(loadSummaries()['a3']).toBeUndefined();
  });

  test('empty summaries are not cached', () => {
    saveSummary('a4', { summary: '', format: 'prose' });
    expect(loadSummaries()['a4']).toBeUndefined();
  });

  test('survives corrupted storage', () => {
    localStorage.setItem('readest_feed_summaries', 'nope');
    expect(loadSummaries()).toEqual({});
    saveSummary('a5', { summary: 's', format: 'prose' });
    expect(loadSummaries()['a5']?.summary).toBe('s');
  });
});
