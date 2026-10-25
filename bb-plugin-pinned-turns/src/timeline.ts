import { useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { Message } from "./model";
import { indexOf, type Row, type TimelineIndex } from "./rows";

type Sdk = ReturnType<typeof useSdk>;
type Page = Awaited<ReturnType<Sdk["threads"]["timeline"]>>;

/** Writes one line to the plugin log; a no-op unless the debug log is on. */
export type Debug = (event: string, data: Record<string, number | string | boolean>) => void;

export type { TimelineIndex };

const EMPTY: TimelineIndex = { rank: new Map(), messages: [], hasOlder: false, userTotal: 0 };

function flatten(rows: readonly Row[], out: Row[] = []): Row[] {
  for (const row of rows) {
    out.push(row);
    if (row.kind === "turn" && row.children) flatten(row.children, out);
  }
  return out;
}

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
  const state = useRef({ rows: [] as Row[], cursor: null as { anchorId: string; anchorSeq: number } | null, loading: false });
  const older = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const s = state.current;
    s.rows = [];
    s.cursor = null;
    s.loading = false;
    setIndex(EMPTY);
    let disposed = false;
    const controller = new AbortController();
    const publish = () => {
      if (disposed) return;
      setIndex(indexOf(s.rows, s.cursor !== null));
    };

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
        rows: s.rows.length,
      });
      Object.assign(stats, { signals: 0, refetches: 0, errors: 0, fetchMsMax: 0, from: performance.now() });
    };
    const count = (key: "signals" | "refetches" | "errors") => {
      stats[key]++;
      if (flushTimer === 0) flushTimer = window.setTimeout(flush, 5000);
    };

    const refreshNewest = async () => {
      const began = performance.now();
      const initial = s.rows.length === 0;
      const page = await sdk.threads.timeline({ threadId, signal: controller.signal });
      if (disposed) return;
      const took = performance.now() - began;
      if (initial) log.current("load", { ms: Math.round(took), rows: page.rows.length, more: page.timelinePage.olderCursor !== null });
      else {
        count("refetches");
        stats.fetchMsMax = Math.max(stats.fetchMsMax, took);
      }
      const fresh = flatten(page.rows);
      const first = fresh[0];
      const firstStart = first === undefined ? 0 : first.sourceSeqStart;
      const ids = new Set(fresh.map((row) => row.id));
      // Rows inside the new window that are not in it any more were rewritten
      // (an edited message reruns); everything older is kept.
      const kept = s.rows.filter((row) => row.sourceSeqStart < firstStart && !ids.has(row.id));
      s.rows = [...kept, ...fresh];
      if (initial) s.cursor = page.timelinePage.olderCursor;
      publish();
    };

    const failed = () => count("errors");
    refreshNewest().catch(failed);
    let timer = 0;
    const unsubscribe = sdk.subscribe({
      event: "thread:changed",
      threadId,
      callback: () => {
        count("signals");
        // A streaming reply signals constantly; one refetch per quiet 300ms is plenty.
        window.clearTimeout(timer);
        timer = window.setTimeout(() => refreshNewest().catch(failed), 300);
      },
    });
    older.current = async () => {
      if (s.loading || s.cursor === null) return;
      s.loading = true;
      const began = performance.now();
      try {
        const page = await sdk.threads.timeline({
          threadId,
          beforeAnchorId: s.cursor.anchorId,
          beforeAnchorSeq: String(s.cursor.anchorSeq),
          signal: controller.signal,
        });
        if (disposed) return;
        s.rows = [...flatten(page.rows), ...s.rows];
        s.cursor = page.timelinePage.olderCursor;
        log.current("older", { ms: Math.round(performance.now() - began), rows: s.rows.length, more: s.cursor !== null });
        publish();
      } finally {
        s.loading = false;
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

  const loadOlder = () => older.current().catch(() => {});
  return { index, loadOlder };
}
