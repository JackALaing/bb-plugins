import { useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { oneLine, turnStatus, type Message, type SpanEvent } from "./model";

type Sdk = ReturnType<typeof useSdk>;
type Page = Awaited<ReturnType<Sdk["threads"]["timeline"]>>;
type Row = Page["rows"][number];

/** Writes one line to the plugin log; a no-op unless the debug log is on. */
export type Debug = (event: string, data: Record<string, number | string | boolean>) => void;

/** The thread's rows in order, and what is known about them. Rebuilt, never mutated. */
export interface TimelineIndex {
  /** Every row id → its position, so a DOM row can be placed among the messages. */
  rank: ReadonlyMap<string, number>;
  messages: readonly Message[];
  /** Whether older rows than the ones held exist and are not fetched yet. */
  hasOlder: boolean;
  /** How many user messages the thread holds so far; complete only when `hasOlder` is false. */
  userTotal: number;
}

const EMPTY: TimelineIndex = { rank: new Map(), messages: [], hasOlder: false, userTotal: 0 };

function flatten(rows: readonly Row[], out: Row[] = []): Row[] {
  for (const row of rows) {
    out.push(row);
    if (row.kind === "turn" && row.children) flatten(row.children, out);
  }
  return out;
}

/** What a user row says when it has no text: its attachments, by name. */
function attachmentTitle(row: Extract<Row, { kind: "conversation"; role: "user" }>): string {
  const a = row.attachments;
  if (!a) return "";
  const names = a.localFileDetails.map((file) => file.name);
  const images = a.localImages + a.webImages + a.imageUrls.length;
  if (names.length > 0) return names.join(", ");
  return images > 0 ? (images === 1 ? "Image" : `${images} images`) : "";
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
  text = text.replace(/^\[bb system\]\s*/, "");
  return text.trim() === "" && row.role === "user" ? attachmentTitle(row) : text;
}

/** What a non-message row says about how its turn went. */
function eventOf(row: Row): SpanEvent | null {
  if (row.kind === "conversation") return row.role === "assistant" ? "assistant" : null;
  if (row.status === "pending") return "pending";
  if (row.kind !== "system") return null;
  if (row.systemKind === "error") return "error";
  return row.systemKind === "operation" && row.operationKind === "thread-interrupted" ? "interrupted" : null;
}

function indexOf(rows: readonly Row[], hasOlder: boolean): TimelineIndex {
  const rank = new Map<string, number>();
  const messages: Message[] = [];
  // A turn runs from one user row to the next; its status is read off the events inside.
  let events: SpanEvent[] = [];
  let replies: Message[] = [];
  const close = () => {
    const status = turnStatus(events);
    if (status) for (const reply of replies) reply.status = status;
    events = [];
    replies = [];
  };
  let userTotal = 0;
  rows.forEach((row, i) => {
    rank.set(row.id, i);
    if (row.kind !== "conversation") {
      const event = eventOf(row);
      if (event) events.push(event);
      return;
    }
    if (row.role === "user") close();
    else events.push("assistant");
    // Another agent's message is not the user's turn to name.
    if (row.role === "user" && row.initiator === "agent") return;
    const full = oneLine(textOf(row), 800);
    if (full === "") return;
    const message: Message = {
      id: row.id,
      role: row.role,
      rank: i,
      seq: row.messageSeq,
      title: full.slice(0, 240),
      full,
      by: row.role === "user" && row.initiator === "system" ? "system" : "user",
    };
    if (row.role === "user") message.ordinal = ++userTotal;
    else replies.push(message);
    messages.push(message);
  });
  close();
  return { rank, messages, hasOlder, userTotal };
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
