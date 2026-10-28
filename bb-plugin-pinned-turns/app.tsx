// bb-plugin-pinned-turns — frontend entry.
//
// An app overlay (React, knows the route's threadId) that portals the bar into
// the thread scroller. React and @get-bb/plugin-sdk/app are provided by BB at
// load time, never bundled.
import { useEffect, useState } from "react";
import { definePluginApp, useBbContext } from "@get-bb/plugin-sdk/app";
import { useOptions } from "./src/options";
import { PinnedTurns } from "./src/PinnedTurns";
import { threadMenu } from "./src/ThreadMenu";
import "./src/styles.css";

/** The longest a thread waits for an idle moment before its bar is mounted anyway. */
const IDLE_WAIT_MS = 1500;
/** Where there is no idle callback (Safari), how long after the thread's paint the bar waits instead. */
const NO_IDLE_WAIT_MS = 200;

/** Run `callback` once the page is idle, or after `IDLE_WAIT_MS` at the latest; returns a canceller. */
function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(callback, { timeout: IDLE_WAIT_MS });
    return () => cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, NO_IDLE_WAIT_MS);
  return () => window.clearTimeout(id);
}

/**
 * The thread whose bar may mount: `threadId` once the page has drawn it and gone
 * idle, `null` until then. Opening a thread is BB's busiest moment (its timeline
 * fetch, mounting and measuring the rows), and the bar is not needed to read it,
 * so its own fetch and setup wait their turn.
 */
function useSettled(threadId: string | null): string | null {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (threadId === null) return;
    let idle = () => {};
    // Two frames: the first runs before the new thread's paint, the second after it.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0;
        idle = whenIdle(() => setSettled(threadId));
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      idle();
    };
  }, [threadId]);
  return settled === threadId ? settled : null;
}

function Overlay() {
  const { threadId } = useBbContext();
  const { ready, enabled } = useOptions();
  const settled = useSettled(threadId);
  // Not before the saved settings are known: a bar switched off would otherwise flash on every thread.
  if (settled === null || !ready || !enabled) return null;
  return <PinnedTurns key={settled} threadId={settled} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "pinned-turns", component: Overlay });
  app.slots.experimental_threadAction(threadMenu);
});
