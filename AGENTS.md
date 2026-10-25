# BBPlugins

A pnpm workspace of BB plugins. One folder per plugin, `bb-plugin-<id>/`, each a normal BB plugin package (`package.json` carries the `bb` manifest). Use the `bb-plugin-authoring` skill for the Plugin SDK contract.

## Code here, run it from bb

Write all plugin code in this repo. Never edit a plugin inside `~/.bb/plugins/` — that directory holds BB's runtime state (`data.db`, logs, secrets), not source.

Link a plugin into bb by path, so bb loads this checkout in place:

```sh
bb plugin install ./bb-plugin-<id> --yes   # once per plugin
bb plugin dev ./bb-plugin-<id>             # rebuild + reload on every save
```

`bb plugin source <id>` should show a local path source pointing back here. If it does not, reinstall it from the path. Do not copy the folder into bb.

## Workspace

- Install with `pnpm install` at the root, never `npm install` in a plugin (no per-plugin `package-lock.json` or `node_modules`).
- `pnpm check` typechecks every plugin; `pnpm build` runs `bb plugin build` in each.
- New plugin: `bb plugin new <name>` in the root, delete its `node_modules` and `package-lock.json`, then `pnpm install`. Strip the todo demo.
- `bb plugin types ./bb-plugin-<id>` repins the SDK and shimmed packages when bb upgrades.

## Plugins

- `bb-plugin-pinned-turns` — pins the user message you are reading under and the latest agent reply to the top of a thread's timeline; click either half to jump. Reference implementation: `dsh-chatux` (`src/model.ts`, `src/bands.ts`) — read it, never modify it.
  - `pnpm --filter bb-plugin-pinned-turns test` runs the model checks (`node --test`, no build). `bandAt` is checked against chatux's `bandContent` as an oracle.
  - Where it departs from chatux, on purpose: it searches row tops once (binary search) and reads titles from timeline data instead of reading every row's rect and text each frame; nothing polls (scroll + ResizeObserver only); the pin line is the scroller's top edge, as in chatux (a lower line made the bar repeat a bubble still visible just under it). A jumped-to row lands `PIN_ROW_HEIGHT` (48px) below the edge, so the bar keeps naming what came before it.
  - Jumps steer by the row's live position each frame (close ~22% of the remaining distance, then hold ~20 frames to catch a late shift) instead of one `scrollTo`: BB mounts/unmounts and re-measures rows during a scroll, so a single smooth scroll stalled early or ended off by tens of px and then visibly corrected. Reader input (wheel/touch/pointer/key) cancels it; a windowed-out row is first brought in with `#msg=<seq>`.
  - Look follows chatux's README/`docs/features/IMPLEMENTED.md`: the bar hangs from the scroller's top edge (box lifted by its corner radius, 12px, with the top padding raised to match), the reply on the left takes the room the message leaves, the message on the right is shrink-to-fit up to 70% of the column, no labels, rise-on-hover shadow, blank halves fade out through the top.
  - Ink: BB's `--surface-recessed` is a translucent 6% tint, so a bar painted with it (or `hover:bg-surface-recessed`) lets the text underneath show through. Use `--surface-recessed-solid` (foreground 6% over background) for the message. The reply is the darker half in both themes via `light-dark()`: foreground 10% in light, 3% in dark (between the chat background and the bubble). BB follows `prefers-color-scheme` (html `color-scheme` flips), so a headless browser can check both with `page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }])` without touching the user's theme.
  - Styling gotchas: `pt-[17px]` was not applied by the plugin's Tailwind build (computed padding-top stayed 0), so structural values are inline styles; `text-overflow: ellipsis` does not work on a `<button>` itself, the text needs an inner `block truncate` span.
  - The thread-header pin button (`src/HeaderMenu.tsx`, `experimental_threadHeaderAction`) opens a Radix dropdown (`@radix-ui/react-dropdown-menu`, shimmed by BB, types only in devDependencies; portalled content spreads `usePortalScopeProps()` from `src/portal-scope.ts`) holding the on/off switch and the options. Each is a boolean plugin setting declared in `server.ts`: `enabled`, `showStatus` (dot on a reply whose turn is running/failed/interrupted), `showPosition` ("7/23" after the message; loads the whole thread), `showFullText` (native tooltip when the bar cut the text), `debugLog`. The frontend reads them with `useSettings()` (`src/options.ts`) but can only write through the backend (`set_setting` RPC → `settings.experimental_set`).
  - Turn status (`turnStatus` in `src/model.ts`, fed by `indexOf` in `src/timeline.ts`): BB's error and interrupted system rows have `turnId: null`, so a turn is the rows between one user row and the next. Running (`status: "pending"` on any row) wins; otherwise the last of reply / error / interrupted decides, so an error a later reply recovered from shows nothing.
  - Agent-initiated user rows (`initiator: "agent"`) are never named; system ones (`initiator: "system"`, child threads finishing) are, with the thread title, and read as "a system message". A user row with no text is titled from its attachments.
  - Debug log: on by default, one line per event in the plugin log (`bb plugin logs pinned-turns`, level `debug`): `load`, `older`, `attach`/`detach`, `jump` (outcome settled/cancelled/timeout/lost, ms, whether it needed `#msg=`), and a `timeline` summary every 5s of activity (`signals` vs `refetches`, `fetchMsMax`, `rows`). `signals` far above `refetches` with the reply title going stale would mean the 300ms debounce in `useTimeline` starves during streaming. Not seen so far (a streaming thread showed signals=13 refetches=4 over 7s); `fetchMsMax` reached ~1s on a 336-row active thread.
  - The RPCs are `set_setting` and `debug`. Timeline data needs no RPC: the page calls `useSdk().threads.timeline` (paged, newest first; `beforeAnchorId`/`beforeAnchorSeq` from `timelinePage.olderCursor`) and `sdk.subscribe({ event: "thread:changed", threadId })`. Older pages are fetched only when a half of the bar has nothing above it.
  - Dev loop: `bb plugin dev` rebuilds in ~150ms and reloads the plugin in the open page without a navigation (state in `window` survives; the old bar is torn down, not duplicated).

## BB timeline DOM facts (bb-app 0.47.0, undocumented, can change)

- Scroller: `[data-page-scroll-viewport]` (overflow-y auto, `overflow-anchor: none`). The 48px `<header>` is outside it, so the scroller's top is already below the header. The thread TOC (`[data-thread-toc]`, ~32px wide, right edge ~12px in) is an overlay sibling at z-30, not inside the scroller, and sits at the vertical middle of the right edge, so it does not meet a bar at the top. The bar uses the text column's own 16px side padding (`px-4`, max 728px) so it lines up with the text at every width.
- Rows: `[data-timeline-row-id]` inside `[data-timeline-items]`. There is no `data-index`; use DOM order. Conversation row ids equal the timeline data's row ids (`thr:user-seed:<seq>`, `thr:assistant:kind:assistant|…`), so data and DOM join on id. BB folds runs of work rows into `<thr>:<turn>:work-summary:<data id of a member>`, which has no data row of its own.
- A user-role row is not always something the user typed: child-thread completions are `[bb system] @thread:…` user rows (`initiator: "system"`) and draw as the thread title. Use `mentions` (`start`, `end`, `resource.label`) to title them.
- User rows: row id `<threadId>:user-seed:<seq>`, and `<seq>` is the event sequence that `#msg=<seq>` takes. `[data-message-column]` is on assistant rows too, so do not use it to spot user messages. Assistant rows: `…:assistant:kind:assistant|turn:<t>|parent:…|item:<i>` (no seq).
- Virtualization: on when the top-level row count is ≥ 20. Unmounted ranges are `div[data-timeline-window-spacer][aria-hidden]` with a pixel height, interleaved with the mounted rows, so `scrollHeight` shifts as rows are measured. The last row is always mounted.
- Jump: setting `location.hash = "#msg=<seq>"` on the open thread scrolls in place and mounts the row, landing it 16px below the scroller top. A 48px bar would cover it, so scroll back by the difference after landing.
- The URL is `/projects/<projectId>/threads/<threadId>`; never build thread URLs by hand.
