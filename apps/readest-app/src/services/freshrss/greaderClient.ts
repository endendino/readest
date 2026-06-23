import type { FreshRSSFolder, FreshRSSFeed, FreshRSSArticle, FreshRSSPage } from '@/types/freshrss';

const READ_TAG = 'user/-/state/com.google/read';
const labelOf = (streamId: string) => streamId.split('/').pop() ?? streamId;

export function parseTagList(json: { tags?: { id: string }[] }): FreshRSSFolder[] {
  return (json.tags ?? [])
    .filter((t) => t.id.includes('/label/'))
    .map((t) => ({ id: t.id, label: labelOf(t.id), unreadCount: 0 }));
}

export function parseSubscriptions(json: {
  subscriptions?: { id: string; title: string; categories?: { id: string }[] }[];
}): FreshRSSFeed[] {
  return (json.subscriptions ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    folderId: s.categories?.[0]?.id ?? null,
    unreadCount: 0,
  }));
}

export function parseUnreadCounts(json: { unreadcounts?: { id: string; count: number }[] }): Map<string, number> {
  const m = new Map<string, number>();
  for (const u of json.unreadcounts ?? []) m.set(u.id, u.count);
  return m;
}

export function mergeUnreadCounts(
  feeds: FreshRSSFeed[],
  folders: FreshRSSFolder[],
  counts: Map<string, number>,
): { feeds: FreshRSSFeed[]; folders: FreshRSSFolder[] } {
  return {
    feeds: feeds.map((f) => ({ ...f, unreadCount: counts.get(f.id) ?? 0 })),
    folders: folders.map((f) => ({ ...f, unreadCount: counts.get(f.id) ?? 0 })),
  };
}

type RawItem = {
  id: string;
  categories?: string[];
  title?: string;
  author?: string;
  published?: number;
  canonical?: { href: string }[];
  alternate?: { href: string }[];
  origin?: { streamId?: string; title?: string };
  content?: { content?: string };
  summary?: { content?: string };
};

export function parseStreamContents(json: { continuation?: string; items?: RawItem[] }): FreshRSSPage {
  const articles: FreshRSSArticle[] = (json.items ?? []).map((it) => ({
    id: it.id,
    feedId: it.origin?.streamId ?? '',
    feedTitle: it.origin?.title ?? '',
    categories: (it.categories ?? [])
      .filter((c) => c.includes('/label/'))
      .map((c) => c.slice(c.indexOf('/label/') + '/label/'.length)),
    title: it.title ?? '(untitled)',
    author: it.author || undefined,
    url: it.canonical?.[0]?.href ?? it.alternate?.[0]?.href ?? '',
    publishedAt: (it.published ?? 0) * 1000,
    contentHtml: it.content?.content ?? it.summary?.content ?? '',
  }));
  return { articles, continuation: json.continuation };
}

export function buildMarkReadBody(itemId: string, writeToken: string): string {
  const p = new URLSearchParams();
  p.set('i', itemId);
  p.set('a', READ_TAG);
  p.set('T', writeToken);
  return p.toString();
}

// --- proxy-backed client -------------------------------------------------
// All connection details (server URL + credentials) live server-side in the
// /api/freshrss route's env vars. This client only ever sends RELATIVE GReader
// paths, so nothing sensitive is held in the browser or the JS bundle and the
// connection survives any browser-storage eviction.

async function proxy(opts: {
  path: string;
  method?: 'GET' | 'POST';
  auth?: string;
  body?: string;
}): Promise<string> {
  const res = await fetch('/api/freshrss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`freshrss proxy ${res.status}`);
  return res.text();
}

export class FreshRSSClient {
  private auth?: string;
  private writeToken?: string;

  async login(): Promise<void> {
    // Credentials are injected server-side on this request.
    const text = await proxy({ path: '/accounts/ClientLogin', method: 'POST' });
    const m = text.match(/Auth=(.+)/);
    if (!m) {
      throw new Error(
        'FreshRSS login failed: check the server configuration (FRESHRSS_URL / FRESHRSS_USERNAME / FRESHRSS_API_PASSWORD)',
      );
    }
    this.auth = m[1]!.trim();
    this.writeToken = (await proxy({ path: '/reader/api/0/token', auth: this.auth })).trim();
  }

  private async getJson<T>(path: string): Promise<T> {
    if (!this.auth) await this.login();
    const text = await proxy({ path, auth: this.auth });
    return JSON.parse(text) as T;
  }

  async listFoldersAndFeeds(): Promise<{ folders: FreshRSSFolder[]; feeds: FreshRSSFeed[] }> {
    const folders = parseTagList(
      await this.getJson<Parameters<typeof parseTagList>[0]>('/reader/api/0/tag/list?output=json'),
    );
    const feeds = parseSubscriptions(
      await this.getJson<Parameters<typeof parseSubscriptions>[0]>('/reader/api/0/subscription/list?output=json'),
    );
    const counts = parseUnreadCounts(
      await this.getJson<Parameters<typeof parseUnreadCounts>[0]>('/reader/api/0/unread-count?output=json'),
    );
    return mergeUnreadCounts(feeds, folders, counts);
  }

  async getUnread(streamId: string, count = 40, continuation?: string): Promise<FreshRSSPage> {
    const p = new URLSearchParams({ output: 'json', xt: READ_TAG, n: String(count) });
    if (continuation) p.set('c', continuation);
    const path = `/reader/api/0/stream/contents/${encodeURIComponent(streamId)}?${p.toString()}`;
    return parseStreamContents(await this.getJson<Parameters<typeof parseStreamContents>[0]>(path));
  }

  async markRead(itemId: string): Promise<void> {
    if (!this.auth || !this.writeToken) await this.login();
    await proxy({
      path: '/reader/api/0/edit-tag',
      method: 'POST',
      auth: this.auth,
      body: buildMarkReadBody(itemId, this.writeToken!),
    });
  }
}
