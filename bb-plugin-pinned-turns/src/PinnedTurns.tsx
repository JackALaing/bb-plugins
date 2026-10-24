import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findTimeline, mountedRows, prefersReducedMotion, rankOfRow, rowById, type Timeline } from "./dom";
import { PIN_ROW_HEIGHT, bandAt, jumpOffset, lastAtOrAbove, type Message } from "./model";
import { useTimeline, type TimelineIndex } from "./timeline";

/**
 * Where a jump leaves a row, as an offset from the scroller's top. The bar's
 * drawn bottom edge is about 38px down, so this leaves it ~10px of clearance.
 */
const LANDING = PIN_ROW_HEIGHT;
/** The corner radius of BB's own message bubble; the bar lifts its top corners by this much. */
const RADIUS = 12;
/**
 * The timeline column's own side padding (`px-4`): the bar is exactly as wide as the
 * text, so it lines up with it at every window width. BB's TOC strip sits at the
 * vertical middle of the right edge, not at the top, so it does not meet the bar.
 */
const SIDE_ROOM = 16;

interface Shown {
  message: Message | null;
  reply: Message | null;
}
const NONE: Shown = { message: null, reply: null };

const sameMessage = (a: Message | null, b: Message | null) => a?.id === b?.id && a?.title === b?.title;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * The bar. It is a zero-height sticky row, the first child of the scroller's
 * frame, so the timeline's layout and scroll height do not change; the rows are
 * never made sticky (they would pile up). One paint per animation frame, driven
 * by scroll and by the items resizing: nothing polls.
 */
export function PinnedTurns({ threadId }: { threadId: string }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState<Shown>(NONE);
  const { index, loadOlder } = useTimeline(threadId);
  const live = useRef({ timeline: null as Timeline | null, index: null as TimelineIndex | null, frame: 0, jump: 0 });
  const paint = useRef(() => {});

  const schedule = useCallback(() => {
    const l = live.current;
    if (l.frame !== 0) return;
    l.frame = requestAnimationFrame(() => {
      l.frame = 0;
      paint.current();
    });
  }, []);

  // What the bar says depends on where the reader is (the boundary row, found by
  // searching the mounted rows' tops) and on the timeline data (everything above it).
  paint.current = () => {
    const { timeline, index: known } = live.current;
    if (!timeline || !known || !timeline.scroller.isConnected) return;
    const rows = mountedRows(timeline.items);
    const pinTop = timeline.scroller.getBoundingClientRect().top;
    // A message is named from the moment its top reaches the scroller's top edge,
    // not before: any lower and the bar repeats a bubble that is still on screen
    // just beneath it.
    const line = pinTop;
    const at = lastAtOrAbove(rows.length, (i) => rows[i]!.getBoundingClientRect().top, line);
    const rank = at < 0 ? null : rankOfRow(rows, at, known.rank);
    let next = NONE;
    if (rank !== null) {
      next = bandAt(known.messages, rank);
      // A half is missing and older rows are not fetched: it is further up.
      if ((next.message === null || next.reply === null) && known.hasOlder) loadOlder();
    } else if (at >= 0 && known.hasOlder) loadOlder();
    setShown((prev) => (sameMessage(prev.message, next.message) && sameMessage(prev.reply, next.reply) ? prev : next));
  };

  useEffect(() => {
    live.current.index = index;
    schedule();
  }, [index, schedule]);

  // Park the row in the scroller and keep it parked. The scroller can be rebuilt
  // under a thread (a layout change), so a cheap check re-attaches when it is gone.
  useEffect(() => {
    let timeline: Timeline | null = null;
    let element: HTMLElement | null = null;
    let observer: ResizeObserver | null = null;
    const l = live.current;

    const detach = () => {
      observer?.disconnect();
      timeline?.scroller.removeEventListener("scroll", schedule);
      element?.remove();
      timeline = element = observer = null;
      l.timeline = null;
      setHost(null);
    };
    const attach = () => {
      if (timeline && element && timeline.scroller.isConnected && timeline.items.isConnected && element.parentElement === timeline.frame) return;
      detach();
      const found = findTimeline(threadId);
      if (!found) return;
      timeline = found;
      element = document.createElement("div");
      element.style.cssText = "position:sticky;top:0;height:0;z-index:20;pointer-events:none";
      found.frame.insertBefore(element, found.frame.firstChild);
      found.scroller.addEventListener("scroll", schedule, { passive: true });
      observer = new ResizeObserver(schedule);
      observer.observe(found.items);
      observer.observe(found.scroller);
      l.timeline = found;
      setHost(element);
      schedule();
    };
    attach();
    const timer = window.setInterval(attach, 500);
    return () => {
      window.clearInterval(timer);
      cancelAnimationFrame(l.frame);
      l.frame = 0;
      detach();
      setShown(NONE);
    };
  }, [threadId, schedule]);

  /**
   * Scroll the row to its landing, steering by where the row is *now*.
   *
   * A single `scrollTo` aims at where the row was when it started, and BB moves
   * the row on the way: rows mount and unmount as the scroll passes, and their
   * measured heights replace estimates, so the row ends up somewhere else and the
   * page visibly corrects itself afterwards. Instead each frame closes a share of
   * the distance that is left to the row's current position, so a shift is
   * absorbed as it happens. A row that is windowed out is brought in by BB's own
   * `#msg=<seq>` scroll first. The reader's own input ends it at once.
   */
  const jump = async (target: Message) => {
    const l = live.current;
    const timeline = l.timeline;
    if (!timeline) return;
    const mine = ++l.jump;
    const stop = () => {
      if (l.jump === mine) l.jump++;
    };
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const name of inputs) window.addEventListener(name, stop, { capture: true, passive: true });
    const ease = prefersReducedMotion() ? 1 : 0.22;
    let hashed = false;
    let missing = 0;
    let settled = 0;
    try {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline && l.jump === mine) {
        const now = l.timeline;
        if (!now) return;
        const row = rowById(now.items, target.id);
        if (!row) {
          // Windowed out and the scroll has brought nothing in: let BB land it.
          if (++missing >= 12 && !hashed) {
            hashed = true;
            const hash = `#msg=${target.seq}`;
            if (location.hash === hash) history.replaceState(history.state, "", location.pathname + location.search);
            location.hash = hash;
          }
          await nextFrame();
          continue;
        }
        missing = 0;
        const { scroller } = now;
        const delta = jumpOffset(row.getBoundingClientRect().top, scroller.getBoundingClientRect().top, LANDING);
        if (Math.abs(delta) <= 1) {
          // Arrived; watch a moment longer for a late shift before letting go.
          if (++settled >= 20) return;
        } else {
          settled = 0;
          const step = Math.max(1, Math.min(Math.abs(delta) * ease, scroller.clientHeight * 1.5));
          scroller.scrollTop += Math.sign(delta) * Math.min(Math.abs(delta), step);
        }
        await nextFrame();
      }
    } finally {
      for (const name of inputs) window.removeEventListener(name, stop, { capture: true });
    }
  };

  if (!host) return null;
  return createPortal(
    // The message is the reader's own bubble, so it sits right at its own width; the
    // reply takes every pixel it leaves. Nothing is measured to keep them apart.
    <div
      className="flex items-start gap-2"
      style={{ margin: "0 auto", maxWidth: `min(728px, calc(100% - ${SIDE_ROOM * 2}px))` }}
    >
      <Half message={shown.reply} what="the latest reply" onJump={jump} className="min-w-0 flex-1" ink={REPLY_INK} />
      <Half message={shown.message} what="your message" onJump={jump} className="ml-auto max-w-[70%] flex-none" ink={MESSAGE_INK} />
    </div>,
    host,
  );
}

/** BB's message bubble ink, made opaque: `--surface-recessed` is translucent and lets the text beneath through. */
const MESSAGE_INK = "var(--surface-recessed-solid)";
/** One step darker than the bubble, in whatever theme the vars resolve to. */
const REPLY_INK = "color-mix(in oklab, var(--foreground) 10%, var(--background))";

/**
 * One half of the bar. It holds its slot when it has nothing to say, fading out
 * through the top edge, so the pair does not shift as the reader scrolls; the
 * last text stays until it has gone.
 */
function Half({
  message,
  what,
  ink,
  className,
  onJump,
}: {
  message: Message | null;
  what: string;
  ink: string;
  className: string;
  onJump: (message: Message) => void;
}) {
  const last = useRef<Message | null>(null);
  if (message) last.current = message;
  const text = message ?? last.current;
  return (
    <div
      className={`${className} transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${message ? "" : "pointer-events-none -translate-y-full opacity-0"}`}
      style={{ pointerEvents: message ? "auto" : "none" }}
    >
      <button
        type="button"
        tabIndex={message ? 0 : -1}
        aria-hidden={!message}
        aria-label={text ? `Jump to ${what}: ${text.title}` : undefined}
        onClick={() => message && onJump(message)}
        // Lifted by its own radius so the top corners sit above the scroller's edge
        // and the bar reads as hanging from it; the top padding is the lift plus a
        // small gap, so hiding the corners costs no visible space.
        className="block w-full max-w-full cursor-pointer rounded-xl border border-border-seam px-4 pb-2.5 text-left text-sm leading-relaxed text-foreground shadow-[0_8px_20px_-8px_rgba(0,0,0,.35)] transition-[transform,box-shadow] duration-100 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-8px_rgba(0,0,0,.5)] focus-visible:-translate-y-0.5 focus-visible:shadow-[0_10px_22px_-8px_rgba(0,0,0,.5)] active:translate-y-px active:shadow-none"
        style={{ background: ink, marginTop: -RADIUS, paddingTop: RADIUS + 5 }}
      >
        {/* The ellipsis needs a block of its own: a button's content box does not clip with one. */}
        <span className="block truncate">{text?.title}</span>
      </button>
    </div>
  );
}
