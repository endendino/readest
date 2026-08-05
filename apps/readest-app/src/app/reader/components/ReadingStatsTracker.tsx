'use client';

import { useEffect, useRef } from 'react';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { TrackerCore, type FlushedEvent } from '@/services/statistics/trackerCore';
import { DEFAULT_STATS_TRACKING_CONFIG } from '@/types/statistics';
import { SyncClient } from '@/libs/sync';
import { pushStats, pullStats } from '@/services/statistics/statsSync';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';

const nowSec = () => Math.floor(Date.now() / 1000);

// Statistics are best-effort telemetry: a failed write or sync (e.g. the
// statistics DB torn down mid-flight on app teardown -> "database ... not
// loaded", Sentry READEST-6) must never surface as an unhandled rejection.
const runBestEffort = (work: Promise<unknown>): void => {
  void work.catch((err) => console.warn('[stats] background operation failed:', err));
};

export default function ReadingStatsTracker({ bookKey }: { bookKey: string }) {
  const { appService } = useEnv();
  // Progress lives in readerProgressStore, not readerStore.viewStates.
  const progress = useBookProgress(bookKey);
  // booksData is keyed by book id = bookKey.split('-')[0].
  const getBookData = useBookDataStore((s) => s.getBookData);
  const { user } = useAuth();
  const coreRef = useRef(new TrackerCore(DEFAULT_STATS_TRACKING_CONFIG));
  const dbRef = useRef<StatisticsDb | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bookData = getBookData(bookKey);
  const book = bookData?.book;
  // FORK PIN: transient books (FreshRSS feed articles staged as EPUBs) are
  // excluded from reading statistics.
  //
  // Why: every progress change here writes through the turso WASM engine
  // (upsertBook + insertPageEvent + recomputeBookTotals with correlated
  // subqueries) on the MAIN THREAD. That engine is the one this fork already
  // had to put behind a circuit breaker in webDatabaseService.ts — it stalls
  // and panics on OPFS writes — and running it on every page turn of every
  // feed article was a direct cause of mid-reading stalls and whole-tab
  // freezes in the RSS flow.
  //
  // Why it's safe: a feed article is not a book. It never enters the library,
  // never syncs, and its hash is re-derived on every staging, so its "reading
  // statistics" are noise that also pollutes the stats DB with rows for
  // documents that no longer exist. Real books are unaffected.
  //
  // If an upstream merge drops this: re-apply it. Guarded by
  // src/__tests__/fork/fork-pins.test.ts — do NOT "fix" that test instead.
  const bookMd5 = book?.transient ? undefined : book?.hash;
  const title = book?.title ?? '';
  // Book.author is the single-string author field; upsertBook takes authors: string.
  const authors = book?.author ?? '';

  const syncEnabled = () => !!user && isSyncCategoryEnabled('stats');

  const schedulePush = () => {
    if (!syncEnabled()) return;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => {
      const db = dbRef.current;
      if (db) runBestEffort(pushStats(db, new SyncClient()));
    }, 10_000);
  };

  useEffect(() => {
    if (!appService) return;
    // FORK PIN (see bookMd5 above): don't even OPEN the statistics DB for a
    // transient feed article — otherwise the turso WASM engine still spins up
    // per article opened, which is precisely the cost this pin removes.
    if (!bookMd5) return;
    let cancelled = false;
    StatisticsDb.open(appService).then((db) => {
      if (cancelled) return;
      dbRef.current = db;
      if (syncEnabled()) runBestEffort(pullStats(db, new SyncClient()));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  // Persist flushed events into the statistics DB.
  const persist = async (events: FlushedEvent[]): Promise<void> => {
    const db = dbRef.current;
    if (!db || !bookMd5 || events.length === 0) return;
    try {
      const idBook = await db.upsertBook({ bookMd5, title, authors });
      for (const e of events) await db.insertPageEvent(idBook, e);
      await db.recomputeBookTotals(idBook);
      schedulePush();
    } catch (err) {
      // The statistics DB can be closed mid-write on app/tab teardown
      // ("database ... not loaded", Sentry READEST-6). Best-effort: log and
      // never reject, so the fire-and-forget dispatch sites stay safe.
      console.warn('[stats] failed to persist reading events:', err);
    }
  };

  const armIdle = () => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(
      () => void persist(coreRef.current.onIdle(nowSec())),
      DEFAULT_STATS_TRACKING_CONFIG.idleTimeoutSeconds * 1000,
    );
  };

  // Page changes drive the tracker.
  useEffect(() => {
    const info = progress?.pageinfo;
    if (!info) return;
    const page = (info.current ?? 0) + 1;
    const total = info.total || 1;
    void persist(coreRef.current.onPage(page, total, nowSec()));
    armIdle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.pageinfo]);

  // Tab/window visibility.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (idleRef.current) clearTimeout(idleRef.current);
        void persist(coreRef.current.onHide(nowSec()));
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookMd5]);

  // Book close (unmount).
  useEffect(() => {
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      runBestEffort(
        persist(coreRef.current.onClose(nowSec())).then(() => {
          if (syncEnabled() && dbRef.current) return pushStats(dbRef.current, new SyncClient());
          return undefined;
        }),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookMd5]);

  return null;
}
