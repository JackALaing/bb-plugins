import { useCallback, useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { flatten, indexOf, mergeNewest, outlineOf, prependOlder, type Outline, type Row, type TimelineIndex } from "./rows";

export type { Outline, TimelineIndex };

/** Writes one line to the plugin log; a no-op unless the debug log is on. */
export type Debug = (event: string, data: Record<string, number | string | boolean>) => void;

const EMPTY: TimelineIndex = { rank: new Map(), messages: [], hasOlder: false };

/** A burst of signals is refetched once it has been quiet this long... */
const QUIET_MS = 300;
/** ...or once its first signal is this old, so a stream that never pauses still refreshes. */
const MAX_WAIT_MS = 1000;
/** Where a failed fetch waits before being tried again. */
const RETRY_MS = 3000;

/** Thread changes that cannot alter a row, so they do not warrant a refetch. */
const IGNORED_CHANGES = new Set([
  "archived-changed",
  "environment-changed",
  "parent-changed",
  "pin-state-changed",
  "queue-changed",
  "read-state-changed",
  "tabs-changed",
  "terminals-changed",
  "title-changed",
]);
/** Changes after which the rows held may no longer exist: they are replaced, not merged. */
const REWRITES = new Set(["history-rewritten", "history-compacted"]);

/**
 * The thread's timeline as an index, kept current.
 *
 * Only the newest page is fetched up front; older pages come on demand
 * (`loadOlder`), because a thread's top is rarely where anyone is. A signal from
 * the thread refetches the newest page and merges it by id, so a streaming reply
 * keeps its title current without refetching history.
 *
 * Timing goes to the debug log: the first load, each older page, and one line per
 * 5s of activity counting the thread's signals against the refetches they caused,
 * which is what shows whether a long reply keeps being refetched while it streams.
 */
export function useTimeline(threadId: string, debug: Debug) {
  const sdk = useSdk();
  const log = useRef(debug);
  log.current = debug;
  const [index, setIndex] = useState<TimelineIndex>(EMPTY);
  const older = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let rows: Row[] = [];
    let cursor: { anchorId: string; anchorSeq: number } | null = null;
    let loaded = false;
    let disposed = false;
    const controller = new AbortController();
    const publish = () => {
      if (!disposed) setIndex(indexOf(rows, cursor !== null));
    };
    setIndex(EMPTY);

    const stats = { signals: 0, refetches: 0, errors: 0, fetchMsMax: 0, from: performance.now() };
    let flushTimer = 0;
    const flush = () => {
      flushTimer = 0;
      log.current("timeline", {
        windowMs: Math.round(performance.now() - stats.from),
        signals: stats.signals,
        refetches: stats.refetches,
        errors: stats.errors,
        fetchMsMax: Math.round(stats.fetchMsMax),
        rows: rows.length,
      });
      Object.assign(stats, { signals: 0, refetches: 0, errors: 0, fetchMsMax: 0, from: performance.now() });
    };
    const count = (key: "signals" | "refetches" | "errors") => {
      stats[key]++;
      flushTimer ||= window.setTimeout(flush, 5000);
    };

    let timer = 0;
    let waitingSince = 0;
    let issued = 0;
    // Set by a signal that says the rows held are stale; the next fetch replaces them.
    let replace = false;
    const refreshNewest = async () => {
      waitingSince = 0;
      // Answers can arrive out of order; only the newest request's is used.
      const mine = ++issued;
      const began = performance.now();
      const rewrite = replace;
      replace = false;
      try {
        const page = await sdk.threads.timeline({ threadId, signal: controller.signal });
        if (disposed || mine !== issued) return;
        const took = performance.now() - began;
        const fresh = flatten(page.rows);
        if (!loaded || rewrite) {
          rows = fresh;
          cursor = page.timelinePage.olderCursor;
          log.current("load", { ms: Math.round(took), rows: rows.length, more: cursor !== null, rewrite });
          loaded = true;
        } else {
          rows = mergeNewest(rows, fresh, flatten(page.timelinePage.olderRowUpdates ?? []));
          count("refetches");
          stats.fetchMsMax = Math.max(stats.fetchMsMax, took);
        }
        publish();
      } catch {
        if (disposed || mine !== issued) return;
        count("errors");
        replace ||= rewrite;
        // Nothing else will prompt a retry on a thread that has gone quiet.
        timer = window.setTimeout(refreshNewest, RETRY_MS);
      }
    };
    refreshNewest();

    const unsubscribe = sdk.subscribe({
      event: "thread:changed",
      threadId,
      callback: ({ changes }) => {
        if (changes.length > 0 && changes.every((change) => IGNORED_CHANGES.has(change))) return;
        count("signals");
        if (changes.some((change) => REWRITES.has(change))) replace = true;
        const now = performance.now();
        waitingSince ||= now;
        window.clearTimeout(timer);
        timer = window.setTimeout(refreshNewest, Math.min(QUIET_MS, waitingSince + MAX_WAIT_MS - now));
      },
    });

    let loading = false;
    let blockedUntil = 0;
    older.current = async () => {
      if (loading || cursor === null || performance.now() < blockedUntil) return;
      loading = true;
      const began = performance.now();
      try {
        const page = await sdk.threads.timeline({
          threadId,
          beforeAnchorId: cursor.anchorId,
          beforeAnchorSeq: String(cursor.anchorSeq),
          signal: controller.signal,
        });
        if (disposed) return;
        rows = prependOlder(rows, flatten(page.rows));
        cursor = page.timelinePage.olderCursor;
        log.current("older", { ms: Math.round(performance.now() - began), rows: rows.length, more: cursor !== null });
        publish();
      } catch {
        // Asked for again on every paint while a half is missing; do not hammer a failing server.
        blockedUntil = performance.now() + RETRY_MS;
      } finally {
        loading = false;
      }
    };
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(flushTimer);
      unsubscribe();
    };
  }, [sdk, threadId]);

  const loadOlder = useCallback(() => older.current(), []);
  return { index, loadOlder };
}

/**
 * The thread's user messages in order, for the turn counter. BB's conversation
 * outline lists every one of them by the timeline's row id in one small response
 * (a few KB, against ~100KB a timeline page), so the counter does not need the
 * older pages fetched. It is fetched again when the newest user message changes,
 * which is the only time the count can.
 */
export function useOutline(threadId: string, enabled: boolean, newestUser: string | undefined): Outline | null {
  const sdk = useSdk();
  const [outline, setOutline] = useState<Outline | null>(null);
  useEffect(() => {
    // Not before the timeline's first page: the outline is fetched once it can be read against it.
    if (!enabled || newestUser === undefined) return;
    const controller = new AbortController();
    let timer = 0;
    const load = async () => {
      try {
        const { items } = await sdk.threads.conversationOutline({ threadId, role: "user", signal: controller.signal });
        if (controller.signal.aborted) return;
        setOutline(outlineOf(items));
      } catch {
        if (!controller.signal.aborted) timer = window.setTimeout(load, RETRY_MS);
      }
    };
    load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [sdk, threadId, enabled, newestUser]);
  return enabled ? outline : null;
}
