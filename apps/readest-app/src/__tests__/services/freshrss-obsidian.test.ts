import { describe, it, expect } from 'vitest';
import { renderArticleMarkdown } from '@/services/freshrss/obsidianExport';

describe('renderArticleMarkdown', () => {
  it('emits frontmatter + highlights as a bullet list', () => {
    const md = renderArticleMarkdown(
      { title: 'כותרת', url: 'https://a.com/x', feedTitle: 'Paper A', publishedAt: 1700000000000 },
      [{ text: 'highlight one', note: 'my note' }, { text: 'highlight two' }],
    );
    expect(md).toContain('title: "כותרת"');
    expect(md).toContain('source: https://a.com/x');
    expect(md).toContain('## Highlights');
    expect(md).toContain('- highlight one');
    expect(md).toContain('my note');
    expect(md).toContain('- highlight two');
  });

  it('returns empty string when there are no highlights', () => {
    expect(
      renderArticleMarkdown({ title: 't', url: 'u', feedTitle: 'f', publishedAt: 0 }, []),
    ).toBe('');
  });
});
