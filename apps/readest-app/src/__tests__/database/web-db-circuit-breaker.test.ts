import { describe, expect, test, vi } from 'vitest';
import { WebDatabaseService } from '@/services/database/webDatabaseService';

/**
 * FORK: the web database wraps turso sqlite-WASM, whose storage layer can
 * break wholesale on some browsers (every write panics — the Firefox
 * "page is slowing down your browser" incident: ReadingStatsTracker's timed
 * flushes each re-entered the panicking WASM). The circuit breaker must stop
 * touching the WASM after MAX_CONSECUTIVE_FAILURES and fail fast instead.
 */

// Reach the private constructor through `open`'s module import? Simpler: the
// class keeps its wasm handle injectable via a tiny test hook — construct via
// Object.create + field assignment to avoid loading the real wasm module.
const makeService = (wasm: {
  prepare: (sql: string) => unknown;
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
}) => {
  const svc = Object.create(WebDatabaseService.prototype) as WebDatabaseService;
  // Reach past `private` to seed the instance without loading the real wasm.
  const handle = svc as unknown as {
    db: unknown;
    consecutiveFailures: number;
    dead: boolean;
    label: string;
  };
  handle.db = wasm;
  handle.consecutiveFailures = 0;
  handle.dead = false;
  handle.label = 'test.db';
  return svc;
};

describe('WebDatabaseService — wasm circuit breaker (FORK)', () => {
  test('after 3 consecutive failures the wasm is never re-entered', async () => {
    const prepare = vi.fn(() => {
      throw new Error('wasm panic: wrote != expected');
    });
    const svc = makeService({ prepare, exec: vi.fn(), close: vi.fn() });

    for (let i = 0; i < 3; i++) {
      await expect(svc.execute('INSERT ...')).rejects.toThrow('wasm panic');
    }
    expect(prepare).toHaveBeenCalledTimes(3);

    // 4th call and beyond: instant rejection, wasm untouched.
    await expect(svc.execute('INSERT ...')).rejects.toThrow('disabled after repeated');
    await expect(svc.select('SELECT 1')).rejects.toThrow('disabled after repeated');
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  test('a success resets the failure count', async () => {
    let fail = true;
    const stmt = { run: vi.fn(async () => ({ changes: 1, lastInsertRowid: 1 })), all: vi.fn() };
    const prepare = vi.fn(() => {
      if (fail) throw new Error('wasm panic');
      return stmt;
    });
    const svc = makeService({ prepare, exec: vi.fn(), close: vi.fn() });

    await expect(svc.execute('x')).rejects.toThrow();
    await expect(svc.execute('x')).rejects.toThrow();
    fail = false;
    await expect(svc.execute('x')).resolves.toBeTruthy(); // resets counter
    fail = true;
    await expect(svc.execute('x')).rejects.toThrow('wasm panic'); // 1st again, not dead
    expect(prepare).toHaveBeenCalledTimes(4);
  });

  test('close() on a dead connection is a no-op (no wasm re-entry)', async () => {
    const close = vi.fn();
    const prepare = vi.fn(() => {
      throw new Error('wasm panic');
    });
    const svc = makeService({ prepare, exec: vi.fn(), close });
    for (let i = 0; i < 3; i++) await svc.execute('x').catch(() => {});
    await svc.close();
    expect(close).not.toHaveBeenCalled();
  });
});
