// bb-plugin-stay-at-bottom — frontend entry.
//
// A content script, nothing rendered. For every thread scroller on the page it
// watches scroll events and, when the view sits a few pixels above the bottom
// with no reader input to explain it, writes it back to the bottom (src/keeper.ts).
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { install } from "./src/keeper";
import { Options } from "./src/Options";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "options", component: Options });
  app.contentScripts.register({
    id: "keeper",
    mount({ signal }) {
      return install(signal);
    },
  });
});
