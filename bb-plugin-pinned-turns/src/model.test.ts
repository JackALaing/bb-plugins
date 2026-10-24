import assert from "node:assert/strict";
import { test } from "node:test";
import { PIN_ROW_HEIGHT, bandAt, bandContent, dataIdOf, jumpOffset, lastAtOrAbove, oneLine, type Message, type Pin } from "./model.ts";

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
      if (r < 0.2) messages.push({ id: `u${rank}`, role: "user", rank, seq: rank, title: `u${rank}` });
      else if (r < 0.45) messages.push({ id: `a${rank}`, role: "assistant", rank, seq: rank, title: `a${rank}` });
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
