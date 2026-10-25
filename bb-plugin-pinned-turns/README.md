# Pinned Turns

A BB plugin. While you scroll a thread's timeline it pins a bar at the top showing the user message you are reading under and the latest agent reply. Click either half to jump to that message.

Click the pin button in the thread header for the menu:

- **Pin the current turn**: the on/off switch.
- **Turn status**: a dot on the reply when its turn is running, failed or was interrupted.
- **Message position**: `7/23` just outside your message's right edge, the first number semibold (loads the whole thread; hidden when the window is under 840px).
- **Full text on hover**: a tooltip when the bar cut a message short.
- **Debug log**: timing lines in the plugin log (`bb plugin logs pinned-turns`).

Each is also a plugin setting.

It reads BB's timeline DOM, which is undocumented; the selectors it relies on are in `src/dom.ts` and the repo's `AGENTS.md`.
