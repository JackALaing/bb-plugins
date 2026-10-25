import assert from "node:assert/strict";
import { test } from "node:test";
import { indexOf } from "./rows.ts";
import { PIN_ROW_HEIGHT, bandAt, bandContent, dataIdOf, jumpOffset, lastAtOrAbove, oneLine, turnStatus, type Message, type Pin } from "./model.ts";

test("bandContent: last message and last reply past the line, same line for both", () => {
  const pin = (top: number, title: string): Pin<string> => ({ top, title, ref: title });
  const openers = [pin(-300, "u1"), pin(-20, "u2"), pin(90, "u3")];
  const replies = [pin(-250, "a1"), pin(10, "a2"), pin(120, "a3")];
  const got = bandContent(openers, replies, 0);
  assert.equal(got.message?.title, "u2");
  assert.equal(got.reply?.title, "a1");
  assert.equal(bandContent(openers, replies, 10).reply?.title, "a2", "a row exactly on the line is in hand");
  assert.deepEqual(bandContent(openers, replies, -400), { message: null, reply: null });
});

test("jumpOffset lands the row one bar below the line", () => {
  assert.equal(jumpOffset(500, 48), 500 - 48 - PIN_ROW_HEIGHT);
  assert.equal(jumpOffset(500, 48, 0), 452);
  assert.equal(jumpOffset(500, 48, -5), 452, "a negative room is no room");
});

test("lastAtOrAbove is a binary search over non-decreasing tops", () => {
  const tops = [-90, -40, -40, 0, 30, 31];
  for (const line of [-100, -90, -40, -1, 0, 30, 31, 500]) {
    const want = tops.reduce((last, top, i) => (top <= line ? i : last), -1);
    assert.equal(lastAtOrAbove(tops.length, (i) => tops[i]!, line), want, `line ${line}`);
  }
});

test("bandAt agrees with bandContent on random timelines", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 300; round++) {
    // Rows of every kind in order; only some are messages. Tops never decrease.
    let top = -rand() * 2000;
    const messages: Message[] = [];
    const rows: { rank: number; top: number }[] = [];
    for (let rank = 0; rank < 40; rank++) {
      top += rand() * 120;
      rows.push({ rank, top });
      const r = rand();
      if (r < 0.2) messages.push({ id: `u${rank}`, role: "user", rank, seq: rank, title: `u${rank}`, full: "", by: "user" });
      else if (r < 0.45) messages.push({ id: `a${rank}`, role: "assistant", rank, seq: rank, title: `a${rank}`, full: "", by: "user" });
    }
    const line = rand() * 1500 - 1000;
    const pins = (role: Message["role"]) =>
      messages
        .filter((m) => m.role === role)
        .map((m) => ({ top: rows[m.rank]!.top, title: m.title, ref: m.id }));
    const oracle = bandContent(pins("user"), pins("assistant"), line);
    const at = lastAtOrAbove(rows.length, (i) => rows[i]!.top, line);
    const got = at < 0 ? { message: null, reply: null } : bandAt(messages, at);
    assert.equal(got.message?.id ?? null, oracle.message?.ref ?? null, `round ${round} message`);
    assert.equal(got.reply?.id ?? null, oracle.reply?.ref ?? null, `round ${round} reply`);
  }
});

test("oneLine collapses whitespace and drops fences and heading marks", () => {
  assert.equal(oneLine("## Plan\n\n```ts\nconst a = 1;\n```\n  next"), "Plan const a = 1; next");
  assert.equal(oneLine("x".repeat(500)).length, 240);
});

test("dataIdOf unwraps a folded work-summary row id", () => {
  assert.equal(dataIdOf("thr_a:user-seed:3"), "thr_a:user-seed:3");
  assert.equal(dataIdOf("thr_a:da-t5:work-summary:thr_a:command:da-i217"), "thr_a:command:da-i217");
});

test("turnStatus: running wins, then the last of reply/failure/interruption", () => {
  assert.equal(turnStatus([]), undefined);
  assert.equal(turnStatus(["assistant"]), undefined);
  assert.equal(turnStatus(["assistant", "pending"]), "pending");
  assert.equal(turnStatus(["error"]), "error");
  assert.equal(turnStatus(["error", "assistant"]), undefined, "a reply after the error recovered the turn");
  assert.equal(turnStatus(["assistant", "interrupted"]), "interrupted");
  assert.equal(turnStatus(["interrupted", "error"]), "error");
});

// Rows as the timeline gives them, cut down to the fields `indexOf` reads.
const user = (seq: number, text = `q${seq}`, extra: object = {}) =>
  ({ kind: "conversation", role: "user", id: `t:user-seed:${seq}`, messageSeq: seq, text, mentions: [], initiator: "user", ...extra }) as never;
const reply = (n: number, text = `a${n}`) => ({ kind: "conversation", role: "assistant", id: `t:assistant:${n}`, messageSeq: 0, text }) as never;
const work = (status: string) => ({ kind: "tool", id: `t:work:${status}`, status }) as never;
const systemError = () => ({ kind: "system", id: "t:err", systemKind: "error", status: "complete" }) as never;

test("indexOf: a running turn marks its question and its replies; a finished one marks neither", () => {
  const { messages } = indexOf([user(1), reply(1), user(2), reply(2), work("pending")], false);
  const byTitle = Object.fromEntries(messages.map((m) => [m.title, m.status]));
  assert.deepEqual(byTitle, { q1: undefined, a1: undefined, q2: "pending", a2: "pending" });
});

test("indexOf: a running turn with no reply yet still marks its question", () => {
  const { messages } = indexOf([user(1), reply(1), user(2), work("pending")], false);
  assert.equal(messages.find((m) => m.title === "q2")?.status, "pending");
  assert.equal(messages.find((m) => m.title === "q1")?.status, undefined);
});

test("indexOf: a failed turn marks only the reply; the question stays unmarked", () => {
  const { messages } = indexOf([user(1), reply(1), systemError()], false);
  assert.equal(messages.find((m) => m.title === "a1")?.status, "error");
  assert.equal(messages.find((m) => m.title === "q1")?.status, undefined);
});

test("indexOf: counts user messages and skips agent-initiated ones", () => {
  const out = indexOf([user(1), reply(1), user(2, "from an agent", { initiator: "agent" }), user(3)], false);
  assert.deepEqual(out.messages.filter((m) => m.role === "user").map((m) => [m.title, m.ordinal]), [["q1", 1], ["q3", 2]]);
  assert.equal(out.userTotal, 2);
});
