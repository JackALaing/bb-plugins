import { useSyncExternalStore } from "react";

/**
 * The channel between the dock button (a composer action, so a React child of
 * BB's composer) and the menu (rendered by the plugin's app overlay, a tree of
 * its own). They are apart on purpose: React replays a portal's pointer events
 * up through the owning tree, so a menu under the composer made BB's capture
 * handler expand the box on every item click. Both live in one bundle, so a
 * module variable is the channel.
 */
export interface MenuState {
  open: boolean;
  /** Where the button is, for the menu to hang from. */
  anchor: DOMRect | null;
}

let state: MenuState = { open: false, anchor: null };
const listeners = new Set<() => void>();

export function setMenu(next: Partial<MenuState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function useMenu(): MenuState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}

/** The button's marker, for the menu to tell its own trigger from an outside click. */
export const BUTTON_ATTR = "data-chat-dock-button";

/**
 * BB's composer expands on any trusted pointer-down inside it, and that handler
 * runs in React's capture phase, ahead of anything the button could do. The
 * event is stopped at the document, before React's root listener, so the
 * composer never sees it; the button's click still arrives.
 */
export function installButtonGuard(): () => void {
  const guard = (event: PointerEvent) => {
    if (!event.isTrusted || !(event.target instanceof Element) || !event.target.closest(`[${BUTTON_ATTR}]`)) return;
    event.stopPropagation();
  };
  document.addEventListener("pointerdown", guard, true);
  return () => document.removeEventListener("pointerdown", guard, true);
}
