// bb-plugin-pinned-turns — backend entry.
//
// Owns the on/off setting. The bar is drawn in the page by app.tsx, which reads
// the timeline with useSdk(); the only RPC is the header toggle writing the
// setting, because the frontend can read plugin settings but not write them.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  set_enabled: { input: z.object({ enabled: z.boolean() }), output: z.null() },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Pin the current turn",
      default: true,
    },
  });
  bb.rpc.register(rpcContract, {
    set_enabled: async ({ enabled }) => {
      await settings.experimental_set({ enabled });
      return null;
    },
  });
  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
