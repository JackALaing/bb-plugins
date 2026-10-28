// bb-plugin-diff-plus — backend entry.
//
// Nothing happens here: the manifest requires a server entry. Everything is in
// the page (app.tsx).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
