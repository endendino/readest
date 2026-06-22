import { describe, it, expect } from 'vitest';
import {
  parseSubscriptions,
  parseTagList,
  parseUnreadCounts,
  mergeUnreadCounts,
  parseStreamContents,
  buildMarkReadBody,
} from '@/services/freshrss/greaderClient';

describe('greader parsers', () => {
  it('parseTagList keeps only label folders', () => {
    const folders = parseTagList({
      tags: [
        { id: 'user/-/label/News' },
        { id: 'user/-/state/com.google/starred' },
        { id: 'user/-/label/Magazines' },
      ],
    });
    expect(folders.map((f) => f.label)).toEqual(['News', 'Magazines']);
  });

  it('parseSubscriptions maps feed + first category to folderId', () => {
    const feeds = parseSubscriptions({
      subscriptions: [
        {
          id: 'feed/https://a.com/rss',
          title: 'Paper A',
          categories: [{ id: 'user/-/label/News' }],
        },
        { id: 'feed/https://b.com/rss', title: 'Mag B', categories: [] },
      ],
    });
    expect(feeds[0]).toMatchObject({
      id: 'feed/https://a.com/rss',
      title: 'Paper A',
      folderId: 'user/-/label/News',
    });
    expect(feeds[1]!.folderId).toBeNull();
  });

  it('mergeUnreadCounts attaches counts to feeds and folders', () => {
    const counts = parseUnreadCounts({
      unreadcounts: [
        { id: 'feed/https://a.com/rss', count: 80 },
        { id: 'user/-/label/News', count: 80 },
      ],
    });
    const { feeds, folders } = mergeUnreadCounts(
      [{ id: 'feed/https://a.com/rss', title: 'Paper A', folderId: 'user/-/label/News', unreadCount: 0 }],
      [{ id: 'user/-/label/News', label: 'News', unreadCount: 0 }],
      counts,
    );
    expect(feeds[0]!.unreadCount).toBe(80);
    expect(folders[0]!.unreadCount).toBe(80);
  });

  it('parseStreamContents prefers content over summary and reads canonical url', () => {
    const page = parseStreamContents({
      continuation: 'CONT',
      items: [
        {
          id: 'tag:google.com,2005:reader/item/0001',
          title: 'כותרת',
          author: 'מחבר',
          published: 1700000000,
          canonical: [{ href: 'https://a.com/x' }],
          categories: ['user/-/state/com.google/reading-list', 'user/-/label/News/Israel'],
          origin: { streamId: 'feed/https://a.com/rss', title: 'Paper A' },
          content: { content: '<p>full</p>' },
          summary: { content: '<p>short</p>' },
        },
      ],
    });
    expect(page.continuation).toBe('CONT');
    expect(page.articles[0]).toMatchObject({
      id: 'tag:google.com,2005:reader/item/0001',
      title: 'כותרת',
      url: 'https://a.com/x',
      feedId: 'feed/https://a.com/rss',
      feedTitle: 'Paper A',
      categories: ['News/Israel'],
      contentHtml: '<p>full</p>',
      publishedAt: 1700000000000,
    });
  });

  it('buildMarkReadBody form-encodes item id + read tag + token', () => {
    expect(buildMarkReadBody('item/1', 'WTOKEN')).toBe(
      'i=item%2F1&a=user%2F-%2Fstate%2Fcom.google%2Fread&T=WTOKEN',
    );
  });
});
