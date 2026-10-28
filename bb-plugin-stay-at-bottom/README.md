# Stay at bottom

A BB plugin. It keeps a streaming thread at its bottom when the browser nudges the view a few pixels up, and leaves it alone when you scrolled.

## Why

BB's own scroll keeper follows a thread's growth while it streams. When a new row arrives it writes the scroll position to the new bottom, and that write lands. A few milliseconds later, inside the browser's own layout pass, the content is briefly shorter (a height transition on an animated wrapper) and the browser clamps the scroll position up by that much. By the time the keeper's `scroll` handler runs the content may be back at full height, so it sees a move up with the extent unchanged and takes it for the reader scrolling: it does not correct. Within its 4px tolerance it stays attached and the view parks a few pixels above the bottom after every row, a slow visible creep. Past 4px it detaches: the "Scroll to latest event" arrow appears and the view stops following. The clamp is usually a few pixels, but the right panel opening narrows the chat column and reflows every row, so it can be much larger there.

## What it does

For every thread scroller on the page (`[data-page-scroll-viewport]`, one per chat pane, rescanned every second so navigating between threads is covered), the plugin keeps a per-scroller "following" flag. It starts on when the view is at the bottom; a scroll that reaches the bottom turns it back on. While following, a `scroll` event that leaves the view above the bottom with nothing the reader did to explain it schedules a write to the bottom for the next animation frame. The conditions are checked again inside the frame, and one frame is pending per scroller at a time.

"Nothing the reader did" means: no `wheel`, `keydown`, `pointerdown` or touch event in the last 500ms, no mouse button held down over the scroller, no touch in progress. Keys and pointer input are counted anywhere on the page, not only over the scroller, so clicking the pinned-turns bar or a search result before a jump does not make that jump look like a clamp. Typing or clicking in the composer or a text field does not count: it cannot scroll the thread, and writing a follow-up while a reply streams is exactly when the view needs holding.

The numbers:

- **96px** is the ordinary ceiling for a repair, and 24px is its floor for a tiny scroller. The dips measured are 2–3px; a larger clamp is covered, while staying below one wheel notch (~100px), so an ordinary scroll is never pulled back.
- **A whole screen** is the ceiling when the content's height or the viewport's width changed since the previous scroll. That is a layout shift (a row growing, or the right panel opening), not the reader. Without this, opening the panel while the view sat slightly above the bottom could snap it back; with it, the panel's larger reflow is followed but a deliberate scroll is left alone.
- **A move larger than the ceiling** stops following instead of repairing: that is navigation, not a clamp.
- **0.5px** is the floor: the browser's own rounding of a fractional scroll position. BB's keeper also ignores scroll events within 0.5px of its own last write.
- **500ms** of quiet is the longest of the keeper's own input windows (150ms after a wheel, 500ms after a key). A scroll inside that window is the reader's and is never touched.

The keeper treats a scroll event that moves down and ends at the bottom as a re-attach, so the write is safe and even repairs a detach. One write is not enough, though: the keeper ignores scroll events within 0.5px of its own last write, so if it already believes it is at the bottom it never sees a direct write back and stays detached — its "Scroll to latest event" arrow remains and the next row anchors instead of following. The repair therefore lands 2px short of the bottom first, then exactly on it in the next frame; the second, downward move is one the keeper sees, and it re-attaches. Nothing else is touched: no `location`, history, focus or DOM.

## Setting

**Keep the thread at its bottom** (`enabled`, on by default) switches it off without uninstalling, from the plugin's page in BB settings or `bb plugin config stay-at-bottom`.