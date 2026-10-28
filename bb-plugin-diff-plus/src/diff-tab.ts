// BB's Diff tab as the folder tree finds and drives it. None of this is an SDK
// contract: it is bb-app 0.47.1's markup, so a BB update can move it, and then
// the tree simply does not show (findDiffTabs finds nothing).
//
//   [data-testid=git-diff-toolbar-layout]     scope picker, summary, actions
//     [data-testid=git-diff-toolbar-selector-slot] button   "All changes", "Committed changes", "<sha> <subject>"
//     [data-testid=git-diff-toolbar-actions]  Search filenames, Filter files, Collapse all, Diff settings
//   (its wrapper's next sibling)              the box around the file list's scroller
//
// The filter box ("Search filenames") takes globs: `docs/**`, `*.md`, `!*.test.ts`.

export interface DiffTab {
  /** The toolbar's wrapper; the filter box appears inside it. */
  toolbar: HTMLElement;
  /** The toolbar's action buttons; the tree's toggle goes first. */
  actions: HTMLElement;
  /** The box around the file list's scroller; the tree column goes in it, before the list. */
  list: HTMLElement;
  /** The thread pane the tab belongs to, if it is in one. */
  pane: Element | null;
}

const LAYOUT = '[data-testid="git-diff-toolbar-layout"]';
const ACTIONS = '[data-testid="git-diff-toolbar-actions"]';
const SCOPE = '[data-testid="git-diff-toolbar-selector-slot"] button';
const FILTER = 'input[aria-label="Filter changed files by path"]';
const OPEN_SEARCH = 'button[aria-label="Search filenames"]';
const CLOSE_SEARCH = 'button[aria-label="Close filename search"]';

export function findDiffTabs(): DiffTab[] {
  const tabs: DiffTab[] = [];
  for (const layout of document.querySelectorAll<HTMLElement>(LAYOUT)) {
    const toolbar = layout.parentElement?.parentElement;
    const actions = layout.querySelector<HTMLElement>(ACTIONS);
    const list = toolbar?.nextElementSibling;
    if (!toolbar || !actions || !(list instanceof HTMLElement)) continue;
    tabs.push({ toolbar, actions, list, pane: toolbar.closest("[data-split-resize-grid-root]") });
  }
  return tabs;
}

/** The thread whose rows are in the tab's pane, when the pane shows a timeline. */
export function paneThread(tab: DiffTab): string | null {
  const row = tab.pane?.querySelector("[data-timeline-row-id]");
  const id = row?.getAttribute("data-timeline-row-id");
  return id ? id.slice(0, id.indexOf(":")) || null : null;
}

/** The scope picker's label, sha and subject joined by a space for a commit. */
export function scopeLabel(tab: DiffTab): string {
  const button = tab.toolbar.querySelector(SCOPE);
  if (!button) return "";
  const parts = [...button.querySelectorAll("span span")].map((span) => span.textContent?.trim() ?? "");
  return (parts.length ? parts.join(" ") : (button.textContent ?? "")).trim();
}

export function filterValue(tab: DiffTab): string {
  return tab.toolbar.querySelector<HTMLInputElement>(FILTER)?.value ?? "";
}

export const isFilterInput = (target: EventTarget | null): target is HTMLInputElement =>
  target instanceof HTMLInputElement && target.matches(FILTER);

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Waits up to `frames` frames for `find` to return something. */
async function waitFor<T>(find: () => T | null | undefined, frames = 20): Promise<T | null> {
  for (let i = 0; i < frames; i++) {
    const found = find();
    if (found) return found;
    await nextFrame();
  }
  return find() ?? null;
}

/**
 * Types `value` into BB's filter box, opening it if it is closed. An empty value
 * closes the box, which clears the filter. The box is a React input, so the
 * value goes through the native setter and an `input` event, as typing would.
 */
export async function setFilter(tab: DiffTab, value: string): Promise<boolean> {
  let input = tab.toolbar.querySelector<HTMLInputElement>(FILTER);
  if (!value) {
    if (input) tab.actions.querySelector<HTMLElement>(CLOSE_SEARCH)?.click();
    return true;
  }
  if (!input) {
    tab.actions.querySelector<HTMLElement>(OPEN_SEARCH)?.click();
    input = await waitFor(() => tab.toolbar.querySelector<HTMLInputElement>(FILTER));
    if (!input) return false;
  }
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** Scrolls the file list back to its first card, where a new filter's matches start. */
export function scrollListToTop(tab: DiffTab): void {
  for (const element of tab.list.querySelectorAll<HTMLElement>("div")) {
    if (element.closest(".diff-plus-tree")) continue;
    const { overflowY } = getComputedStyle(element);
    if (overflowY === "auto" || overflowY === "scroll") {
      element.scrollTop = 0;
      return;
    }
  }
}

/** Opens the file's card in the list once the filter has brought it in. */
export async function expandFile(tab: DiffTab, path: string): Promise<void> {
  const button = await waitFor(() =>
    [...tab.list.querySelectorAll<HTMLElement>("button[aria-label]")].find((b) => {
      if (b.closest(".diff-plus-tree")) return false;
      const label = b.getAttribute("aria-label");
      return label === `Expand ${path}` || label === `Collapse ${path}`;
    }),
  );
  if (button?.getAttribute("aria-label") === `Expand ${path}`) button.click();
}

/**
 * Calls `onChange` when a Diff tab may have appeared, gone, or changed scope.
 * BB keeps the right panel's element across navigation and remounts what is
 * inside it, so the observer watches the panels (found again every second) and
 * skips changes inside a tab's file list, where scrolling mounts and unmounts
 * cards all the time.
 */
export function watchDiffTabs(onChange: () => void, lists: () => readonly HTMLElement[]): () => void {
  const observed = new Set<Element>();
  const observer = new MutationObserver((records) => {
    const inside = lists();
    if (records.some((record) => !inside.some((list) => list.contains(record.target)))) onChange();
  });
  const attach = () => {
    for (const panel of document.querySelectorAll("#thread-detail-secondary-panel, [data-testid=secondary-panel-shelf]")) {
      if (observed.has(panel)) continue;
      observed.add(panel);
      observer.observe(panel, { childList: true, subtree: true, characterData: true });
    }
    for (const panel of observed) if (!panel.isConnected) observed.delete(panel);
  };
  attach();
  const timer = setInterval(() => {
    const before = observed.size;
    attach();
    if (observed.size !== before) onChange();
  }, 1000);
  return () => {
    clearInterval(timer);
    observer.disconnect();
  };
}
