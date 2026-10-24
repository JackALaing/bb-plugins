# Pinned Turns

A BB plugin. While you scroll a thread's timeline it pins a bar at the top showing the user message you are reading under and the latest agent reply. Click either half to jump to that message.

Toggle it with the pin button in the thread header, or the `enabled` setting (default on).

It reads BB's timeline DOM, which is undocumented; the selectors it relies on are in `src/dom.ts` and the repo's `AGENTS.md`.
