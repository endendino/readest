import { beforeEach, describe, expect, test } from 'vitest';
import {
  clearOpenArticleByGreaderId,
  loadOpenArticles,
  saveOpenArticle,
} from '@/services/freshrss/openArticleStore';

/**
 * FORK: the reader's Done / Save-to-Obsidian buttons render only when the open
 * book's hash resolves to a feed article. That mapping used to be session-only,
 * so a reload (or a mobile tab-kill) made both buttons vanish with no way to
 * mark the article read. It now persists per device.
 */

describe('openArticleStore (FORK feed Done/Save persistence)', () => {
  beforeEach(() => localStorage.clear());

  test('round-trips a mapping by book hash', () => {
    saveOpenArticle('hash1', { greaderId: 'tag:item/abc', streamId: 'feed/1' });
    expect(loadOpenArticles()['hash1']).toEqual({ greaderId: 'tag:item/abc', streamId: 'feed/1' });
  });

  test('empty inputs are ignored', () => {
    saveOpenArticle('', { greaderId: 'x', streamId: 's' });
    saveOpenArticle('h', { greaderId: '', streamId: 's' });
    expect(Object.keys(loadOpenArticles())).toHaveLength(0);
  });

  test('clearing by article id removes every hash pointing at it', () => {
    // The same article re-staged across sessions gets a fresh hash each time.
    saveOpenArticle('hashA', { greaderId: 'item/1', streamId: 's' });
    saveOpenArticle('hashB', { greaderId: 'item/1', streamId: 's' });
    saveOpenArticle('hashC', { greaderId: 'item/2', streamId: 's' });
    clearOpenArticleByGreaderId('item/1');
    const map = loadOpenArticles();
    expect(map['hashA']).toBeUndefined();
    expect(map['hashB']).toBeUndefined();
    expect(map['hashC']).toBeDefined();
  });

  test('prunes oldest entries beyond the cap (100)', () => {
    for (let i = 0; i < 105; i++) {
      saveOpenArticle(`h${i}`, { greaderId: `item/${i}`, streamId: 's' });
    }
    const map = loadOpenArticles();
    expect(map['h0']).toBeUndefined();
    expect(map['h104']).toBeDefined();
    expect(Object.keys(map).length).toBeLessThanOrEqual(100);
  });

  test('survives corrupted storage', () => {
    localStorage.setItem('readest_feed_open_articles', '{not json');
    expect(loadOpenArticles()).toEqual({});
    saveOpenArticle('h', { greaderId: 'item/9', streamId: 's' });
    expect(loadOpenArticles()['h']?.greaderId).toBe('item/9');
  });
});
