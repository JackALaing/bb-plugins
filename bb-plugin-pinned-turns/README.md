# Pinned Turns

A BB plugin. While you scroll a thread's timeline it pins a bar at the top showing the user message you are reading under and the latest agent reply. Click either half to jump to that message.

Click the pin button in the thread header for the menu:

- **Pin the current turn**: the on/off switch.
- **Turn status**: your message and the reply pulse while the turn runs; a dot marks one that failed or was interrupted.
- **Turn counter**: `7/23` just outside your message's right edge, the first number semibold (loads the whole thread; left out when the thread view is under 840px wide, where it would be clipped).
- **Full text on hover**: a tooltip when the bar cut a message short.
- **Debug log**: timing lines in the plugin log (`bb plugin logs pinned-turns`).
- **Show this button**: switch it off to hide the pin button; turn it back on in the plugin's page in BB settings.
- **Plugin settings**: opens that page.

Each is also a plugin setting.

It reads BB's timeline DOM, which is undocumented; the selectors it relies on are in `src/dom.ts` and the repo's `AGENTS.md`.
