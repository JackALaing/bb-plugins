import type { useSdk } from "@get-bb/plugin-sdk/app";
import { oneLine, turnStatus, type Message, type SpanEvent } from "./model.ts";

type Page = Awaited<ReturnType<ReturnType<typeof useSdk>["threads"]["timeline"]>>;
export type Row = Page["rows"][number];

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

export function indexOf(rows: readonly Row[], hasOlder: boolean): TimelineIndex {
  const rank = new Map<string, number>();
  const messages: Message[] = [];
  // A turn runs from one user row to the next; its status is read off the events inside.
  let events: SpanEvent[] = [];
  let replies: Message[] = [];
  let asked: Message | null = null;
  const close = () => {
    const status = turnStatus(events);
    if (status) for (const reply of replies) reply.status = status;
    // The question only shows that its turn is still running; how it ended is the reply's to say.
    if (status === "pending" && asked) asked.status = status;
    events = [];
    replies = [];
    asked = null;
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
    if (row.role === "user") {
      message.ordinal = ++userTotal;
      asked = message;
    } else replies.push(message);
    messages.push(message);
  });
  close();
  return { rank, messages, hasOlder, userTotal };
}

