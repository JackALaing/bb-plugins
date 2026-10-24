import { useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { oneLine, type Message } from "./model";

type Sdk = ReturnType<typeof useSdk>;
type Page = Awaited<ReturnType<Sdk["threads"]["timeline"]>>;
type Row = Page["rows"][number];

/** The thread's rows in order, and what is known about them. Rebuilt, never mutated. */
export interface TimelineIndex {
  /** Every row id → its position, so a DOM row can be placed among the messages. */
  rank: ReadonlyMap<string, number>;
  messages: readonly Message[];
  /** Whether older rows than the ones held exist and are not fetched yet. */
  hasOlder: boolean;
}

const EMPTY: TimelineIndex = { rank: new Map(), messages: [], hasOlder: false };

function flatten(rows: readonly Row[], out: Row[] = []): Row[] {
  for (const row of rows) {
    out.push(row);
    if (row.kind === "turn" && row.children) flatten(row.children, out);
  }
  return out;
}

/** A row's text as the timeline draws it: mentions as their labels, BB's own tag dropped. */
function textOf(row: Extract<Row, { kind: "conversation" }>): string {
  let text = row.text;
  if (row.role === "user") {
    // `@thread:thr_x` is drawn as the thread's title; later ranges first keeps offsets valid.
    for (const { start, end, resource } of [...row.mentions].sort((a, b) => b.start - a.start)) {
      text = text.slice(0, start) + resource.label + text.slice(end);
    }
  }
  return text.replace(/^\[bb system\]\s*/, "");
}

function indexOf(rows: readonly Row[], hasOlder: boolean): TimelineIndex {
  const rank = new Map<string, number>();
  const messages: Message[] = [];
  rows.forEach((row, i) => {
    rank.set(row.id, i);
    if (row.kind !== "conversation") return;
    const title = oneLine(textOf(row));
    if (title === "") return;
    messages.push({ id: row.id, role: row.role, rank: i, seq: row.messageSeq, title });
  });
  return { rank, messages, hasOlder };
}

/**
 * The thread's timeline as an index, kept current.
 *
 * Only the newest page is fetched up front; older pages come on demand
 * (`loadOlder`), because a thread's top is rarely where anyone is. A signal from
 * the thread refetches the newest page and merges it by id, so a streaming reply
 * keeps its title current without refetching history.
 */
export function useTimeline(threadId: string) {
  const sdk = useSdk();
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

    const refreshNewest = async () => {
      const page = await sdk.threads.timeline({ threadId, signal: controller.signal });
      if (disposed) return;
      const fresh = flatten(page.rows);
      const first = fresh[0];
      const firstStart = first === undefined ? 0 : first.sourceSeqStart;
      const ids = new Set(fresh.map((row) => row.id));
      // Rows inside the new window that are not in it any more were rewritten
      // (an edited message reruns); everything older is kept.
      const kept = s.rows.filter((row) => row.sourceSeqStart < firstStart && !ids.has(row.id));
      const initial = s.rows.length === 0;
      s.rows = [...kept, ...fresh];
      if (initial) s.cursor = page.timelinePage.olderCursor;
      publish();
    };

    refreshNewest().catch(() => {});
    let timer = 0;
    const unsubscribe = sdk.subscribe({
      event: "thread:changed",
      threadId,
      callback: () => {
        // A streaming reply signals constantly; one refetch per quiet 300ms is plenty.
        window.clearTimeout(timer);
        timer = window.setTimeout(() => refreshNewest().catch(() => {}), 300);
      },
    });
    older.current = async () => {
      if (s.loading || s.cursor === null) return;
      s.loading = true;
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
        publish();
      } finally {
        s.loading = false;
      }
    };
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [sdk, threadId]);

  const loadOlder = () => older.current().catch(() => {});
  return { index, loadOlder };
}
