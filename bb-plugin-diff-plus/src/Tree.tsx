// The folder tree beside BB's Diff tab.
//
// `TreeOverlay` is an app overlay: it finds each Diff tab on the page
// (src/diff-tab.ts) and, for each, portals a toggle into the tab's toolbar and,
// while the tree is on, a column into the box around its file list. A click on a
// folder types `folder/**` into BB's own filter box; a click on a file types its
// path and opens its card. The list, its diffs and its filtering stay BB's.
//
// The files come from `sdk.environments.diffFiles` for the scope the tab shows,
// fetched only while a tree is on, and again when the environment's git state
// changes. Nothing here reads the composer, so typing never re-renders the tree.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { experimental_Icon as Icon, useBbContext, useSdk } from "@get-bb/plugin-sdk/app";
import {
  expandFile,
  filterValue,
  findDiffTabs,
  isFilterInput,
  paneThread,
  scopeLabel,
  scrollListToTop,
  setFilter,
  watchDiffTabs,
  type DiffTab,
} from "./diff-tab";
import {
  ancestors,
  buildTree,
  fileName,
  folderPattern,
  initialOpen,
  scopeOf,
  selectedBy,
  statusOf,
  type Scope,
  type TreeDir,
  type TreeFile,
} from "./folders";
import { fileIcon, folderIcon } from "./file-icons";

/** Environment changes that can change which files differ. */
const REFRESH_ON = new Set(["status-changed", "git-refs-changed", "metadata-changed"]);
/** Quiet time after a git change before the files are fetched again; agents write in bursts. */
const REFRESH_WAIT_MS = 1000;
/** A failed fetch is tried again after this long. */
const RETRY_MS = 3000;
/** Under this width the tree goes above the file list instead of beside it, as Diff Tree's did. */
const STACK_BELOW = 600;

// ---------------------------------------------------------------------------
// Whether the tree is on: one choice for every Diff tab, kept in localStorage.

const OPEN_KEY = "bb-plugin-diff-plus:tree";
const openListeners = new Set<() => void>();
const readOpen = (): boolean | null => {
  const value = localStorage.getItem(OPEN_KEY);
  return value === "open" ? true : value === "closed" ? false : null;
};
const subscribeOpen = (listener: () => void) => {
  openListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    openListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};
const writeOpen = (open: boolean) => {
  localStorage.setItem(OPEN_KEY, open ? "open" : "closed");
  for (const listener of openListeners) listener();
};
const useOpenChoice = () => useSyncExternalStore(subscribeOpen, readOpen);

// The tree's width, once the reader has dragged its edge; until then the
// stylesheet's default. Room is always left for the file list beside it. It is
// a custom property so the stacked layout can ignore it.
const WIDTH_KEY = "bb-plugin-diff-plus:tree-width";
const WIDTH_VAR = "--diff-plus-tree-width";
const MIN_WIDTH = 140;
const LIST_ROOM = 240;
const RESIZE_STEP = 16;
const clampWidth = (width: number, list: HTMLElement) =>
  Math.round(Math.max(MIN_WIDTH, Math.min(width, list.clientWidth - LIST_ROOM)));
const storedWidth = () => Number(localStorage.getItem(WIDTH_KEY)) || null;

// ---------------------------------------------------------------------------
// The Diff tabs on the page.

interface TabState {
  tab: DiffTab;
  label: string;
  filter: string;
  thread: string | null;
}

const ids = new WeakMap<Element, number>();
let nextId = 1;
const idOf = (element: Element) => {
  let id = ids.get(element);
  if (!id) ids.set(element, (id = nextId++));
  return id;
};

const sameTab = (a: TabState, b: TabState) =>
  a.tab.list === b.tab.list && a.tab.actions === b.tab.actions && a.tab.toolbar === b.tab.toolbar &&
  a.label === b.label && a.filter === b.filter && a.thread === b.thread;

function useDiffTabs(fallbackThread: string | null): TabState[] {
  const [tabs, setTabs] = useState<TabState[]>([]);
  useEffect(() => {
    let frame = 0;
    let current: TabState[] = [];
    const check = () => {
      frame = 0;
      const next = findDiffTabs().map((tab) => ({
        tab,
        label: scopeLabel(tab),
        filter: filterValue(tab),
        thread: paneThread(tab) ?? fallbackThread,
      }));
      if (next.length === current.length && next.every((state, i) => sameTab(state, current[i]!))) return;
      current = next;
      setTabs(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const stop = watchDiffTabs(schedule, () => current.map((state) => state.tab.list));
    // Typing in BB's filter box changes its value without touching the DOM.
    const typed = (event: Event) => isFilterInput(event.target) && schedule();
    document.addEventListener("input", typed, true);
    check();
    return () => {
      stop();
      document.removeEventListener("input", typed, true);
      cancelAnimationFrame(frame);
    };
  }, [fallbackThread]);
  return tabs;
}

export function TreeOverlay() {
  const { threadId } = useBbContext();
  const tabs = useDiffTabs(threadId);
  return (
    <>
      {tabs.map((state) => (
        <TabTree key={idOf(state.tab.list)} {...state} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// One tab: the toggle in its toolbar and, while on, the column.

/** An element of ours put first in `parent` for as long as the component is mounted. */
function useHost(parent: HTMLElement | null, className: string) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!parent) return;
    const element = document.createElement("div");
    element.className = className;
    parent.prepend(element);
    setHost(element);
    return () => {
      element.remove();
      setHost(null);
    };
  }, [parent, className]);
  return host;
}

type Layout = "side" | "stacked";

/** Whether the tree fits beside the list, read from the list's width while `list` is given. */
function useLayout(list: HTMLElement | null): Layout {
  const [layout, setLayout] = useState<Layout>("side");
  useLayoutEffect(() => {
    if (!list) return;
    const read = () => setLayout(list.clientWidth < STACK_BELOW ? "stacked" : "side");
    read();
    const observer = new ResizeObserver(read);
    observer.observe(list);
    return () => observer.disconnect();
  }, [list]);
  return layout;
}

function TabTree({ tab, label, filter, thread }: TabState) {
  const open = useOpenChoice() ?? true;
  const toggleHost = useHost(tab.actions, "diff-plus-toggle-host");
  const columnHost = useHost(open ? tab.list : null, "diff-plus-tree");
  const layout = useLayout(columnHost ? tab.list : null);
  // The stylesheet lays the list's box out as a row ("side") or a column ("stacked").
  useLayoutEffect(() => {
    if (!columnHost) return;
    tab.list.setAttribute("data-diff-plus-tree", layout);
    return () => tab.list.removeAttribute("data-diff-plus-tree");
  }, [columnHost, layout, tab.list]);
  return (
    <>
      {toggleHost &&
        createPortal(
          <button
            type="button"
            className="diff-plus-toggle"
            aria-label={open ? "Hide folder tree" : "Show folder tree"}
            title={open ? "Hide folder tree" : "Show folder tree"}
            aria-pressed={open}
            onClick={() => writeOpen(!open)}
          >
            <Icon name="Folder" className="diff-plus-icon" aria-hidden />
          </button>,
          toggleHost,
        )}
      {columnHost &&
        createPortal(
          <>
            <div className="diff-plus-tree-scroll">
              <TreeColumn tab={tab} label={label} filter={filter} thread={thread} />
            </div>
            <ResizeHandle column={columnHost} list={tab.list} />
          </>,
          columnHost,
        )}
    </>
  );
}

/** The column's right edge, beside the list only: drag it, or focus it and use the arrow keys. */
function ResizeHandle({ column, list }: { column: HTMLElement; list: HTMLElement }) {
  useLayoutEffect(() => {
    const width = storedWidth();
    if (width) column.style.setProperty(WIDTH_VAR, `${clampWidth(width, list)}px`);
    else column.style.removeProperty(WIDTH_VAR);
  }, [column, list]);
  const set = (width: number) => {
    const next = clampWidth(width, list);
    column.style.setProperty(WIDTH_VAR, `${next}px`);
    return next;
  };
  return (
    <div
      className="diff-plus-tree-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize folder tree"
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const start = event.clientX - column.getBoundingClientRect().width;
        let last = column.getBoundingClientRect().width;
        const move = (e: PointerEvent) => (last = set(e.clientX - start));
        const end = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", end);
          handle.removeEventListener("pointercancel", end);
          localStorage.setItem(WIDTH_KEY, String(last));
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const width = column.getBoundingClientRect().width;
        localStorage.setItem(WIDTH_KEY, String(set(width + (event.key === "ArrowLeft" ? -RESIZE_STEP : RESIZE_STEP))));
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// The files.

type Files =
  | { status: "loading" }
  | { status: "ready"; files: TreeFile[]; truncated: boolean }
  | { status: "error"; message: string };

function useChangedFiles(threadId: string | null, scope: Scope | null): Files {
  const sdk = useSdk();
  const [files, setFiles] = useState<Files>({ status: "loading" });
  const scopeKey = scope ? JSON.stringify(scope) : null;
  useEffect(() => {
    setFiles({ status: "loading" });
    if (!threadId || !scope) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | null = null;

    const load = async () => {
      controller?.abort();
      const { signal } = (controller = new AbortController());
      try {
        const { environmentId } = await sdk.threads.get({ threadId, signal });
        if (!environmentId) throw new Error("This thread has no environment.");
        if (!unsubscribe && !disposed) {
          unsubscribe = sdk.subscribe({
            event: "environment:changed",
            environmentId,
            callback: ({ changes }) => {
              if (!changes.some((change) => REFRESH_ON.has(change))) return;
              clearTimeout(timer);
              timer = setTimeout(load, REFRESH_WAIT_MS);
            },
          });
        }
        const environment = await sdk.environments.get({ environmentId, signal });
        const base = environment.mergeBaseBranch ?? environment.defaultBranch;
        const query =
          scope.target === "all" || scope.target === "branch_committed"
            ? base
              ? { target: scope.target, mergeBaseBranch: base }
              : null
            : scope;
        if (!query) throw new Error("This environment has no base branch to compare with.");
        const result = await sdk.environments.diffFiles({ environmentId, ...query, signal });
        if (disposed || signal.aborted) return;
        if (result.outcome !== "available") {
          setFiles({ status: "error", message: result.outcome === "unavailable" ? result.failure.message : result.message });
          return;
        }
        setFiles({
          status: "ready",
          truncated: result.truncated,
          files: result.files.map((file) => ({
            path: file.path,
            previousPath: file.previousPath,
            additions: file.additions,
            deletions: file.deletions,
            changeKind: file.changeKind,
            untracked: file.origin === "untracked",
          })),
        });
      } catch (cause) {
        if (disposed || signal.aborted) return;
        setFiles((previous) =>
          previous.status === "ready" ? previous : { status: "error", message: cause instanceof Error ? cause.message : String(cause) },
        );
        clearTimeout(timer);
        timer = setTimeout(load, RETRY_MS);
      }
    };
    void load();
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [sdk, threadId, scopeKey]); // scopeKey stands for scope
  return files;
}

// ---------------------------------------------------------------------------
// The column.

const numbers = new Intl.NumberFormat();

function Stats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="diff-plus-stats">
      {additions > 0 && <span className="diff-plus-added">+{numbers.format(additions)}</span>}
      {deletions > 0 && <span className="diff-plus-removed">−{numbers.format(deletions)}</span>}
    </span>
  );
}

/** A vscode-icons glyph, drawn by its class in src/icons.css. */
const FileIcon = ({ icon }: { icon: string }) => <span className={`diff-plus-file-icon diff-plus-i-${icon}`} aria-hidden />;

interface RowsProps {
  dir: TreeDir;
  depth: number;
  open: ReadonlySet<string>;
  /** "dir:<path>" or "file:<path>" for the row the filter stands for. */
  active: string | null;
  toggle: (path: string) => void;
  pick: (kind: "dir" | "file", path: string) => void;
}

const indent = (depth: number) => ({ paddingLeft: `${0.25 + depth * 0.75}rem` });

const Rows = memo(function Rows({ dir, depth, open, active, toggle, pick }: RowsProps) {
  return (
    <>
      {dir.dirs.map((child) => {
        const expanded = open.has(child.path);
        return (
          <div key={child.path} role="none">
            <div className="diff-plus-row" data-active={active === `dir:${child.path}` || undefined} style={indent(depth)}>
              {/* The folder's icon opens and closes it (no chevrons: the open and closed icons show the state). */}
              <button
                type="button"
                className="diff-plus-twisty"
                // Not "Expand <path>": BB labels its file cards that way, and
                // expandFile looks them up by label.
                aria-label={`${child.path}/`}
                aria-expanded={expanded}
                title={expanded ? "Close folder" : "Open folder"}
                onClick={() => toggle(child.path)}
              >
                <FileIcon icon={folderIcon(child.path, expanded)} />
              </button>
              <button
                type="button"
                className="diff-plus-pick"
                role="treeitem"
                aria-expanded={expanded}
                aria-selected={active === `dir:${child.path}`}
                title={`${child.path}/ · ${child.count} ${child.count === 1 ? "file" : "files"}`}
                onClick={() => pick("dir", child.path)}
              >
                <span className="diff-plus-name">{child.name}</span>
                <span className="diff-plus-count">{child.count}</span>
                <Stats additions={child.additions} deletions={child.deletions} />
                <span className="diff-plus-mark" data-tone={child.tone ?? undefined} aria-hidden>
                  <span className="diff-plus-dot" />
                </span>
              </button>
            </div>
            {expanded && (
              <div role="group">
                <Rows dir={child} depth={depth + 1} open={open} active={active} toggle={toggle} pick={pick} />
              </div>
            )}
          </div>
        );
      })}
      {dir.files.map((file) => {
        const status = statusOf(file);
        return (
          <div key={file.path} className="diff-plus-row" data-active={active === `file:${file.path}` || undefined} style={indent(depth)}>
            <button
              type="button"
              className="diff-plus-pick"
              role="treeitem"
              aria-selected={active === `file:${file.path}`}
              title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
              onClick={() => pick("file", file.path)}
            >
              <FileIcon icon={fileIcon(file.path)} />
              <span className="diff-plus-name" data-deleted={file.changeKind === "deleted" || undefined}>
                {fileName(file.path)}
              </span>
              <Stats additions={file.additions} deletions={file.deletions} />
              <span className="diff-plus-mark" data-tone={status.tone} title={status.title}>
                {status.mark}
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
});

function TreeColumn({ tab, label, filter, thread }: Omit<TabState, "tab"> & { tab: DiffTab }) {
  const scope = useMemo(() => scopeOf(label), [label]);
  const files = useChangedFiles(thread, scope);
  const tree = useMemo(() => (files.status === "ready" ? buildTree(files.files) : null), [files]);

  // Folders open per scope: the first load of a scope picks them, later loads keep the reader's.
  const [open, setOpen] = useState<{ label: string; paths: Set<string> } | null>(null);
  useEffect(() => {
    if (tree && open?.label !== label) setOpen({ label, paths: initialOpen(tree) });
  }, [tree, label, open?.label]);
  const paths = open?.label === label ? open.paths : null;

  const toggle = useCallback(
    (path: string) =>
      setOpen((previous) => {
        if (!previous) return previous;
        const next = new Set(previous.paths);
        if (!next.delete(path)) next.add(path);
        return { ...previous, paths: next };
      }),
    [],
  );
  const selected = selectedBy(filter);
  const active = selected ? `${selected.kind}:${selected.path}` : null;
  const pick = useCallback(
    (kind: "dir" | "file", path: string) => {
      if (active === `${kind}:${path}`) {
        void setFilter(tab, "");
        return;
      }
      if (tree) {
        setOpen((previous) => {
          if (!previous) return previous;
          const next = new Set(previous.paths);
          for (const dir of ancestors(tree, path)) next.add(dir);
          if (kind === "dir") next.add(path);
          return { ...previous, paths: next };
        });
      }
      void setFilter(tab, kind === "dir" ? folderPattern(path) : path).then((done) => {
        if (!done) return;
        scrollListToTop(tab);
        if (kind === "file") void expandFile(tab, path);
      });
    },
    [active, tab, tree],
  );

  if (!scope) return <p className="diff-plus-tree-note">No folder tree for this view.</p>;
  if (files.status === "loading") return <p className="diff-plus-tree-note">Loading files…</p>;
  if (files.status === "error") return <p className="diff-plus-tree-note" role="alert">{files.message}</p>;
  if (!tree || !paths) return null;
  if (!tree.count) return <p className="diff-plus-tree-note">No changes.</p>;
  return (
    <div role="tree" aria-label="Changed files by folder">
      <div className="diff-plus-row diff-plus-root" data-active={!filter.trim() || undefined}>
        <button
          type="button"
          className="diff-plus-pick"
          role="treeitem"
          aria-selected={!filter.trim()}
          title="Show every file"
          onClick={() => filter.trim() && void setFilter(tab, "")}
        >
          <span className="diff-plus-name">All files</span>
          <span className="diff-plus-count">{tree.count}</span>
          <Stats additions={tree.additions} deletions={tree.deletions} />
          {/* The letters' room, so the root's +/- line up with the rows'. */}
          <span className="diff-plus-mark" />
        </button>
      </div>
      <Rows dir={tree} depth={0} open={paths} active={active} toggle={toggle} pick={pick} />
      {files.truncated && <p className="diff-plus-tree-note">BB cut this list short; filter by path to find the rest.</p>}
    </div>
  );
}
