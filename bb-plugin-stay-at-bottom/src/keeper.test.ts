import test from "node:test";
import assert from "node:assert/strict";
import { allowRepair, BURST_MS, BURST_REPAIRS, MAX_GAP, MIN_GAP, nextState, repairCeiling, type Reading } from "./keeper.ts";

const base: Reading = {
  gap: 10,
  pinned: true,
  quiet: true,
  layoutChanged: false,
  viewport: 600,
  moved: 10,
};

const read = (patch: Partial<Reading> = {}): Reading => ({ ...base, ...patch });

test("a small dip while following is repaired", () => {
  assert.deepEqual(nextState(read({ gap: 3, moved: 3 })), { pinned: true, repair: true });
});

test("a view already above the bottom is left alone", () => {
  assert.deepEqual(nextState(read({ gap: 10, pinned: false })), { pinned: false, repair: false });
});

test("a gap at the rounding floor pins without a write", () => {
  assert.deepEqual(nextState(read({ gap: MIN_GAP, moved: 0 })), { pinned: true, repair: false });
});

test("reader input stops following", () => {
  assert.deepEqual(nextState(read({ gap: 3, quiet: false })), { pinned: false, repair: false });
});

test("a gap past the old 24px ceiling is repaired while following", () => {
  assert.deepEqual(nextState(read({ gap: MAX_GAP + 1, moved: MAX_GAP + 1 })), {
    pinned: true,
    repair: true,
  });
});

test("the ordinary ceiling is below one wheel notch", () => {
  assert.equal(repairCeiling(read()), 96);
  assert.deepEqual(nextState(read({ gap: 97, moved: 97 })), { pinned: false, repair: false });
});

test("a layout change raises the ceiling to a full screen", () => {
  assert.equal(repairCeiling(read({ layoutChanged: true })), 600);
  assert.deepEqual(nextState(read({ gap: 400, moved: 400, layoutChanged: true })), {
    pinned: true,
    repair: true,
  });
});

test("a jump further than a screen is navigation even during a layout change", () => {
  assert.deepEqual(nextState(read({ gap: 400, moved: 601, layoutChanged: true })), {
    pinned: false,
    repair: false,
  });
});

test("a layout gap past a full screen is not chased", () => {
  assert.deepEqual(nextState(read({ gap: 601, moved: 601, layoutChanged: true })), {
    pinned: false,
    repair: false,
  });
});

test("a right-panel-sized gap is repaired when the layout changed", () => {
  assert.deepEqual(nextState(read({ gap: 148, moved: 148, viewport: 300, layoutChanged: true })), {
    pinned: true,
    repair: true,
  });
});

test("a tiny scroller still gets the 24px floor", () => {
  assert.equal(repairCeiling(read({ viewport: 20 })), MAX_GAP);
  assert.deepEqual(nextState(read({ gap: 20, moved: 20, viewport: 20 })), {
    pinned: true,
    repair: true,
  });
});
test("a burst of repairs is cut off and resumes once it ages out", () => {
  const log: number[] = [];
  for (let i = 0; i < BURST_REPAIRS; i++) assert.equal(allowRepair(log, i * 10), true);
  assert.equal(allowRepair(log, 100), false);
  assert.equal(allowRepair(log, BURST_MS + 5), true);
});
