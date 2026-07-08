import { describe, expect, test } from 'vitest';
import { loadLibraryBooks, saveLibraryBooks } from '@/services/libraryService';
import type { Book } from '@/types/book';
import type { BaseDir, FileSystem } from '@/types/system';

/**
 * FORK invariant: transient books (feed articles imported for a single reader
 * session) must never be persisted to library.json — in any save path — and
 * any transient row already on disk (older builds) is dropped on load.
 * This is the guard against the feed-article shelf-pollution incident, where
 * article rows leaked into library.json, were pushed to the shared cloud
 * index, and were re-adopted as phantom "books" on other devices.
 */

const makeBook = (hash: string, extra: Partial<Book> = {}): Book =>
  ({
    hash,
    format: 'EPUB',
    title: hash,
    sourceTitle: hash,
    author: 'a',
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }) as Book;

/** Minimal in-memory FileSystem covering what libraryService touches. */
const makeFs = (initial?: Book[]) => {
  const files = new Map<string, string>();
  if (initial) files.set('library.json', JSON.stringify(initial));
  const fs = {
    exists: async () => true,
    createDir: async () => {},
    readFile: async (path: string, _base: BaseDir, mode?: string) => {
      const body = files.get(path.split('/').pop()!) ?? files.get(path);
      if (body === undefined) throw new Error(`no file ${path}`);
      return mode === 'text' ? body : new TextEncoder().encode(body).buffer;
    },
    writeFile: async (path: string, _base: BaseDir, content: unknown) => {
      files.set(
        path.split('/').pop()!,
        typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer),
      );
    },
    removeFile: async () => {},
    getPrefix: async () => '',
    resolvePath: (path: string, base: BaseDir) => ({ baseDir: 0, basePrefix: '', fp: path, base }),
  } as unknown as FileSystem;
  return { fs, files };
};

const savedBooks = (files: Map<string, string>): Book[] => {
  // safeSaveJSON may write to a tmp name then the real one; take any entry
  // that parses to an array of books.
  for (const [, body] of files) {
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) return parsed as Book[];
    } catch {
      /* keep looking */
    }
  }
  return [];
};

describe('libraryService — transient rows never persist (FORK)', () => {
  test('saveLibraryBooks(replace) drops transient rows', async () => {
    const { fs, files } = makeFs();
    await saveLibraryBooks(
      fs,
      [makeBook('real'), makeBook('article', { transient: true, deletedAt: 1 })],
      { replace: true },
    );
    const saved = savedBooks(files);
    expect(saved.map((b) => b.hash)).toEqual(['real']);
  });

  test('saveLibraryBooks(merge) drops transient rows but keeps disk floor', async () => {
    const { fs, files } = makeFs([makeBook('on-disk')]);
    await saveLibraryBooks(fs, [
      makeBook('real'),
      makeBook('article', { transient: true, deletedAt: 1 }),
    ]);
    const saved = savedBooks(files);
    expect(saved.map((b) => b.hash).sort()).toEqual(['on-disk', 'real']);
  });

  test('loadLibraryBooks drops transient rows left by older builds', async () => {
    const { fs } = makeFs([makeBook('real'), makeBook('leaked', { transient: true })]);
    const books = await loadLibraryBooks(fs, async () => '');
    expect(books.map((b) => b.hash)).toEqual(['real']);
  });
});
