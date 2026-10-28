// The whole plugin. BB's own scroll keeper keeps a streaming thread at its
// bottom, but the browser's layout pass sometimes clamps the scroll position a
// few pixels up right after the keeper's write (the content is briefly shorter
// while an animated wrapper changes height). The keeper's scroll handler then
// sees a move up with the extent unchanged and takes it for the reader, so the
// view parks a few pixels above the bottom after every new row, and detaches
// outright when the dip passes its 4px threshold. Here: while the view is
// following the bottom, a scroll that leaves it above the bottom with nothing
// the reader did to explain it is written back. A single write to the bottom can
// be ignored: the keeper ignores scroll events within 0.5px of its own last
// write, so if it already thinks it is at the bottom it never sees the repair,
// stays detached and shows its "Scroll to latest event" arrow. The repair
// therefore lands just short of the bottom first, then exactly on it in the next
// frame; the keeper sees that second, downward move and re-attaches.
//
// A larger dip is chased further when the content's height or the viewport's
// width changed since the previous scroll: that is a layout shift (a streamed
// row growing, or the right panel opening and narrowing the column), not the
// reader. Even without one, a gap up to 96px is repaired while following (half
// a screen on a short scroller); past that, or past a move of the same size, it
// is navigation and the view stops following.

/** BB's thread timeline scroller. There is one per chat pane. */
export const SCROLLER = "[data-page-scroll-viewport]";
/** A gap this small is the browser's rounding, not a dip. */
export const MIN_GAP = 0.5;
/** The smallest ceiling for a repair; a shorter scroller still gets this much room. */
export const MAX_GAP = 24;
/** The ordinary ceiling: below one wheel notch (~100px), above a plausible clamp. */
export const ORDINARY_GAP = 96;
/** How far short of the bottom the first of a repair's two writes lands. Must be more than BB's 0.5px ignore window and less than its 4px at-the-end threshold. */
const SETTLE = 2;
/** How long after the reader's last input a scroll is taken to be theirs. BB's own windows are 150ms (wheel) and 500ms (keys). */
export const QUIET_MS = 500;
/** Repairs allowed per `BURST_MS` before the plugin stands down: past that it is fighting something, and the 2px hop shows as shimmering text. */
export const BURST_REPAIRS = 4;
export const BURST_MS = 1500;
/** How often the page is scanned for scrollers that came or went. */
export const SCAN_MS = 1000;

const PASSIVE_CAPTURE = { passive: true, capture: true } as const;

let enabled = true;
/** The `enabled` setting, written by `Options` as it loads or changes. */
export function setEnabled(value: boolean): void {
  enabled = value;
}

/** BB's composer, wherever it is (Chat Dock moves it into the right panel). */
const COMPOSER = "[data-app-composer]";

/** Input aimed at the composer or a text field, which types rather than scrolls the timeline. */
function cannotScroll(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(COMPOSER)) return true;
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
}

/** Pixels between the view's bottom edge and the content's. */
export function gapOf(s: HTMLElement): number {
  return s.scrollHeight - s.clientHeight - s.scrollTop;
}

/** What one scroll event says about the view. */
export type Reading = {
  gap: number;
  /** Whether the view was following the bottom before this event. */
  pinned: boolean;
  /** No reader input within `QUIET_MS`, no held pointer, no touch in progress. */
  quiet: boolean;
  /** The content's height or the viewport's width changed since the previous scroll. */
  layoutChanged: boolean;
  /** The scroller's visible height, the most a layout shift may have moved it. */
  viewport: number;
  /** `scrollTop` change since the previous scroll. */
  moved: number;
};

/** What to do after a scroll: keep following, repair the gap, or stop following. */
export type Decision = {
  pinned: boolean;
  repair: boolean;
};

/**
 * The furthest a repair will chase. Without evidence of a layout shift, an
 * ordinary clamp is all that is repaired (half a screen, capped below one wheel
 * notch). A layout change (a row growing, the right panel opening and narrowing
 * the column) can move the view a whole screen, so it gets that much room. A
 * longer move is navigation, not a dip.
 */
export function repairCeiling(r: Reading): number {
  if (r.layoutChanged) return Math.max(MAX_GAP, r.viewport);
  return Math.max(MAX_GAP, Math.min(ORDINARY_GAP, r.viewport / 2));
}

/**
 * Decide whether a scroll that leaves the view `gap` px above the bottom is a
 * dip to repair. While following the bottom, a gap within the ceiling and no
 * larger than the reader's own last move is repaired. A jump past that ceiling
 * is navigation, and any unexplained gap stops following, so a reader who
 * scrolled up is not pulled back by the next row.
 */
export function nextState(r: Reading): Decision {
  if (r.gap <= MIN_GAP) return { pinned: true, repair: false };
  if (!r.pinned) return { pinned: false, repair: false };
  if (!r.quiet) return { pinned: false, repair: false };
  const ceiling = repairCeiling(r);
  if (Math.abs(r.moved) > ceiling || r.gap > ceiling) {
    return { pinned: false, repair: false };
  }
  return { pinned: true, repair: true };
}

/**
 * Record a repair at `now` in `log` (oldest first) and say whether it may go
 * ahead. Repairs older than `BURST_MS` are forgotten; a refused one is not
 * recorded, so the plugin resumes once the burst has aged out.
 */
export function allowRepair(log: number[], now: number): boolean {
  while (log.length && now - log[0] > BURST_MS) log.shift();
  if (log.length >= BURST_REPAIRS) return false;
  log.push(now);
  return true;
}

type Watched = {
  /** When recent repairs started, for `allowRepair`. */
  repairs: number[];
  held: boolean;
  touching: boolean;
  frame: number;
  /** Following the bottom until the reader scrolls away. */
  pinned: boolean;
  /** Scrolled while switched off: the next scroll only takes stock. */
  stale: boolean;
  top: number;
  width: number;
  viewport: number;
  height: number;
  stop: () => void;
};

/**
 * Watch every thread scroller on the page until `signal` aborts or the returned
 * disposer runs. One pending frame per scroller; a reader's input (wheel, key,
 * touch, pointer) within `QUIET_MS`, a held pointer or a touch in progress stands
 * every correction down. Nothing but `scrollTop` is ever written.
 */
export function install(signal: AbortSignal): () => void {
  const own = new AbortController();
  const stopAll = () => own.abort();
  signal.addEventListener("abort", stopAll, { once: true });
  const sig = own.signal;

  let lastInput = -Infinity;
  const noteInput = () => {
    lastInput = performance.now();
  };
  // Keys and clicks anywhere can move the scroller (Page Down, the pinned-turns
  // bar, a search result): count them as the reader's, so a jump is not read as a
  // clamp. Not typing or clicking in the composer or a field, though: a reader
  // writing a follow-up while the reply streams is exactly when dips happen.
  const notePageInput = (event: Event) => {
    if (!cannotScroll(event.target)) noteInput();
  };
  window.addEventListener("keydown", notePageInput, { ...PASSIVE_CAPTURE, signal: sig });
  window.addEventListener("pointerdown", notePageInput, { ...PASSIVE_CAPTURE, signal: sig });

  const watched = new Map<HTMLElement, Watched>();

  const watch = (s: HTMLElement) => {
    const ctl = new AbortController();
    const opts = { ...PASSIVE_CAPTURE, signal: ctl.signal };
    const w: Watched = {
      held: false,
      touching: false,
      frame: 0,
      repairs: [],
      pinned: gapOf(s) <= MIN_GAP,
      stale: false,
      top: s.scrollTop,
      width: s.clientWidth,
      viewport: s.clientHeight,
      height: s.scrollHeight,
      stop: () => ctl.abort(),
    };
    const quiet = () => !w.held && !w.touching && performance.now() - lastInput > QUIET_MS;

    s.addEventListener("wheel", noteInput, opts);
    s.addEventListener("pointerdown", () => {
      noteInput();
      w.held = true;
    }, opts);
    for (const type of ["pointerup", "pointercancel"] as const) {
      window.addEventListener(type, () => {
        w.held = false;
      }, opts);
    }
    s.addEventListener("touchstart", () => {
      noteInput();
      w.touching = true;
    }, opts);
    s.addEventListener("touchmove", noteInput, opts);
    for (const type of ["touchend", "touchcancel"] as const) {
      window.addEventListener(type, () => {
        noteInput();
        w.touching = false;
      }, opts);
    }
    s.addEventListener("scroll", (event) => {
      // The listener captures, so it also hears every scroll area inside the timeline
      // (code blocks, tables); those do not move the scroller, and reading its layout
      // for them is wasted.
      if (event.target !== s) return;
      // Switched off, nothing is read; the first scroll once it is back on only takes stock.
      if (!enabled) {
        w.stale = true;
        return;
      }
      const top = s.scrollTop;
      const gap = gapOf(s);
      const width = s.clientWidth;
      const viewport = s.clientHeight;
      const height = s.scrollHeight;
      const heightChange = Math.abs(height - w.height);
      const layoutChanged = width !== w.width
        || viewport !== w.viewport
        || (heightChange > 0 && heightChange <= Math.max(MAX_GAP, viewport));
      const moved = top - w.top;
      w.top = top;
      w.width = width;
      w.viewport = viewport;
      w.height = height;
      if (w.stale) {
        w.stale = false;
        w.pinned = gap <= MIN_GAP;
        return;
      }
      if (w.frame) return;
      const decision = nextState({ gap, pinned: w.pinned, quiet: quiet(), layoutChanged, viewport, moved });
      w.pinned = decision.pinned;
      if (!decision.repair) return;
      if (!allowRepair(w.repairs, performance.now())) return;
      w.frame = requestAnimationFrame(() => {
        w.frame = 0;
        // The content may have grown or the reader moved since the event: look again.
        if (!enabled || !quiet() || !w.pinned) return;
        const g = gapOf(s);
        if (g <= MIN_GAP) {
          w.pinned = true;
          return;
        }
        if (g > Math.max(MAX_GAP, s.clientHeight)) {
          w.pinned = false;
          return;
        }
        const max = s.scrollHeight - s.clientHeight;
        const landed = Math.max(0, max - SETTLE);
        // Land short first and finish on the next frame. A single write to the
        // bottom is ignored when the keeper's own last write was already there,
        // which leaves it detached with its arrow showing.
        w.frame = requestAnimationFrame(() => {
          w.frame = 0;
          if (!enabled || !quiet() || !w.pinned) return;
          const end = s.scrollHeight - s.clientHeight;
          if (gapOf(s) > Math.max(MAX_GAP, s.clientHeight)) {
            w.pinned = false;
            return;
          }
          s.scrollTop = end;
          w.top = s.scrollTop;
          w.width = s.clientWidth;
          w.viewport = s.clientHeight;
          w.height = s.scrollHeight;
          w.pinned = true;
        });
        s.scrollTop = landed;
        w.top = landed;
        w.width = s.clientWidth;
        w.viewport = s.clientHeight;
        w.height = s.scrollHeight;
      });
    }, opts);
    ctl.signal.addEventListener("abort", () => {
      if (w.frame) cancelAnimationFrame(w.frame);
    });
    watched.set(s, w);
  };

  const scan = () => {
    const present = new Set<HTMLElement>(document.querySelectorAll<HTMLElement>(SCROLLER));
    for (const [s, w] of watched) {
      if (!present.has(s)) {
        w.stop();
        watched.delete(s);
      }
    }
    for (const s of present) if (!watched.has(s)) watch(s);
  };
  scan();
  const timer = window.setInterval(scan, SCAN_MS);
  sig.addEventListener("abort", () => {
    window.clearInterval(timer);
    for (const w of watched.values()) w.stop();
    watched.clear();
  });

  return stopAll;
}