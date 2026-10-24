// bb-plugin-pinned-turns — frontend entry.
//
// An app overlay (React, knows the route's threadId) that portals the bar into
// the thread scroller. React and @get-bb/plugin-sdk/app are provided by BB at
// load time, never bundled.
import { definePluginApp, useBbContext, useSettings } from "@get-bb/plugin-sdk/app";
import { HeaderToggle } from "./src/HeaderToggle";
import { PinnedTurns } from "./src/PinnedTurns";

function Overlay() {
  const { threadId } = useBbContext();
  const { values } = useSettings();
  if (threadId === null || values?.enabled === false) return null;
  return <PinnedTurns key={threadId} threadId={threadId} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "pinned-turns", component: Overlay });
  app.slots.experimental_threadHeaderAction({ id: "toggle", title: "Pinned turns", component: HeaderToggle });
});
