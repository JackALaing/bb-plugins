import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { findTimeline, mountedRows, prefersReducedMotion, rankOfRow, rowById, type Timeline } from "./dom";
import { PIN_ROW_HEIGHT, bandAt, jumpOffset, lastAtOrAbove, type Message, type TurnStatus } from "./model";
import { useOptions } from "./options";
import { useTimeline, type Debug, type TimelineIndex } from "./timeline";

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
/**
 * The position counter hangs outside the bar's right edge. Below this scroller width
 * the bar fills the column and the counter would be clipped, so it is left out.
 */
const POSITION_ROOM = 840;

interface Shown {
  message: Message | null;
  reply: Message | null;
}
const NONE: Shown = { message: null, reply: null };

const sameMessage = (a: Message | null, b: Message | null) =>
  a?.id === b?.id && a?.title === b?.title && a?.status === b?.status && a?.ordinal === b?.ordinal;

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
  const [roomForPosition, setRoomForPosition] = useState(true);
  const options = useOptions();
  const rpc = useRpc<typeof rpcContract>();
  // The server drops these unless the debug log is on; skipping the call here saves the round trip.
  const debug = useCallback<Debug>(
    (event, data) => {
      if (options.debugLog) rpc.call("debug", { event, data }).catch(() => {});
    },
    [rpc, options.debugLog],
  );
  const log = useRef(debug);
  log.current = debug;
  const { index, loadOlder } = useTimeline(threadId, debug);
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

  // "7/23" needs every message, so while it is on the older pages are fetched in turn.
  useEffect(() => {
    if (options.showPosition && index.hasOlder) loadOlder();
  }, [options.showPosition, index, loadOlder]);

  // Park the row in the scroller and keep it parked. The scroller can be rebuilt
  // under a thread (a layout change), so a cheap check re-attaches when it is gone.
  useEffect(() => {
    let timeline: Timeline | null = null;
    let element: HTMLElement | null = null;
    let observer: ResizeObserver | null = null;
    const l = live.current;

    const detach = () => {
      if (timeline) log.current("detach", { scrollerConnected: timeline.scroller.isConnected, itemsConnected: timeline.items.isConnected });
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
      observer = new ResizeObserver(() => {
        setRoomForPosition(found.scroller.clientWidth >= POSITION_ROOM);
        schedule();
      });
      observer.observe(found.items);
      observer.observe(found.scroller);
      l.timeline = found;
      log.current("attach", { rows: found.items.children.length });
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
    let outcome = "timeout";
    const began = performance.now();
    try {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline && l.jump === mine) {
        const now = l.timeline;
        if (!now) {
          outcome = "lost";
          return;
        }
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
          if (++settled >= 20) {
            outcome = "settled";
            return;
          }
        } else {
          settled = 0;
          const step = Math.max(1, Math.min(Math.abs(delta) * ease, scroller.clientHeight * 1.5));
          scroller.scrollTop += Math.sign(delta) * Math.min(Math.abs(delta), step);
        }
        await nextFrame();
      }
    } finally {
      for (const name of inputs) window.removeEventListener(name, stop, { capture: true });
      if (l.jump !== mine) outcome = "cancelled";
      log.current("jump", { to: target.role, outcome, ms: Math.round(performance.now() - began), hashed });
    }
  };

  if (!host) return null;
  const total = options.showPosition && !index.hasOlder ? index.userTotal : 0;
  return createPortal(
    // The message is the reader's own bubble, so it sits right at its own width; the
    // reply takes every pixel it leaves. Nothing is measured to keep them apart.
    <div
      className="flex items-start gap-2"
      style={{ margin: "0 auto", maxWidth: `min(728px, calc(100% - ${SIDE_ROOM * 2}px))` }}
    >
      <Half message={shown.reply} onJump={jump} className="min-w-0 flex-1" ink={REPLY_INK} status={options.showStatus} tooltip={options.showFullText} />
      <Half
        message={shown.message}
        onJump={jump}
        className="ml-auto max-w-[70%] flex-none"
        ink={MESSAGE_INK}
        tooltip={options.showFullText}
        position={roomForPosition && total > 0 && shown.message?.ordinal ? { ordinal: shown.message.ordinal, total } : undefined}
      />
    </div>,
    host,
  );
}

/** BB's message bubble ink, made opaque: `--surface-recessed` is translucent and lets the text beneath through. */
const MESSAGE_INK = "var(--surface-recessed-solid)";
/**
 * The reply is the darker of the two, in either theme. In the light theme that is
 * more foreground mixed into the background than the bubble has; in the dark theme
 * it is less, so it sits between the chat background and the bubble.
 */
const REPLY_INK =
  "light-dark(color-mix(in oklab, var(--foreground) 10%, var(--background)), color-mix(in oklab, var(--foreground) 3%, var(--background)))";

/**
 * One half of the bar. It holds its slot when it has nothing to say, fading out
 * through the top edge, so the pair does not shift as the reader scrolls; the
 * last text stays until it has gone.
 */
const STATUS_DOT: Record<TurnStatus, { color: string; label: string; pulse?: boolean }> = {
  pending: { color: "var(--foreground)", label: "This turn is still running", pulse: true },
  error: { color: "#d4493a", label: "This turn ended in an error" },
  interrupted: { color: "#c98a1a", label: "This turn was interrupted" },
};

function Half({
  message,
  ink,
  className,
  status,
  tooltip,
  position,
  onJump,
}: {
  message: Message | null;
  ink: string;
  className: string;
  /** Mark the turn's status on this half (the reply). */
  status?: boolean;
  /** Offer the full text on hover when the bar cut it short. */
  tooltip: boolean;
  /** Where this message sits among the thread's, drawn outside the half's right edge. */
  position?: { ordinal: number; total: number };
  onJump: (message: Message) => void;
}) {
  const last = useRef<Message | null>(null);
  if (message) last.current = message;
  const text = message ?? last.current;
  const dot = status && text?.status ? STATUS_DOT[text.status] : null;
  const what = text?.role === "assistant" ? "the latest reply" : text?.by === "system" ? "a system message" : "your message";
  return (
    <div
      className={`${className} relative transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${message ? "" : "pointer-events-none -translate-y-full opacity-0"}`}
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
        className="flex w-full max-w-full cursor-pointer items-center gap-2 rounded-xl border border-border-seam px-4 pb-2.5 text-left text-sm leading-relaxed text-foreground shadow-[0_8px_20px_-8px_rgba(0,0,0,.35)] transition-[transform,box-shadow] duration-100 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-8px_rgba(0,0,0,.5)] focus-visible:-translate-y-0.5 focus-visible:shadow-[0_10px_22px_-8px_rgba(0,0,0,.5)] active:translate-y-px active:shadow-none"
        style={{ background: ink, marginTop: -RADIUS, paddingTop: RADIUS + 5 }}
      >
        {dot ? (
          <span
            title={dot.label}
            aria-label={dot.label}
            className={`h-2 w-2 shrink-0 rounded-full ${dot.pulse ? "animate-pulse" : ""}`}
            style={{ background: dot.color }}
          />
        ) : null}
        {/* The ellipsis needs a block of its own: a button's content box does not clip with one. */}
        <span
          className="block min-w-0 truncate"
          // Only when the bar cut the text short; a native tooltip on a whole line is noise.
          onMouseEnter={(event) => {
            const el = event.currentTarget;
            const cut = tooltip && text && el.scrollWidth > el.clientWidth;
            if (cut) el.title = text.full;
            else el.removeAttribute("title");
          }}
        >
          {text?.title}
        </span>
      </button>
      {/* Hangs off the right edge so it never takes width from the message (see POSITION_ROOM). */}
      {position ? (
        // The same size and line height as the message's text, with the smaller figures
        // inside it, so the two share a baseline.
        <span
          aria-hidden
          className="pointer-events-none absolute whitespace-nowrap text-sm leading-relaxed tabular-nums text-foreground opacity-33"
          style={{ left: "100%", marginLeft: 6, top: 6 }}
        >
          <span style={{ fontSize: "90%" }}>
            <span className="font-semibold">{position.ordinal}</span>/{position.total}
          </span>
        </span>
      ) : null}
    </div>
  );
}
