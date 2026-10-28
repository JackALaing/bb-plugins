// bb-plugin-stay-at-bottom — backend entry.
//
// Nothing happens here: the manifest requires a server entry, and this one only
// declares the plugin's one setting, which the page reads with `useSettings()`.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Keep the thread at its bottom",
      description: "Put the view back at the bottom when the browser nudges it a few pixels up during a stream. Off, nothing happens.",
      default: true,
    },
  });
  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
