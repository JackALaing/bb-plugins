// bb-plugin-pinned-turns — backend entry.
//
// Owns the settings and the debug log. The bar is drawn in the page by app.tsx,
// which reads the timeline with useSdk(); the page calls back here only to write a
// setting (the frontend can read plugin settings but not write them) and to hand
// over debug lines (the frontend has no plugin logger).
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** The boolean settings the header menu switches. */
export const SETTING_KEYS = ["enabled", "showStatus", "showPosition", "showFullText", "debugLog", "showPinButton"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const rpcContract = defineRpcContract({
  set_setting: { input: z.object({ key: z.enum(SETTING_KEYS), value: z.boolean() }), output: z.null() },
  debug: {
    input: z.object({
      event: z.string().max(40),
      data: z.record(z.string().max(40), z.union([z.number(), z.string().max(200), z.boolean()])),
    }),
    output: z.null(),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: { type: "boolean", label: "Pin the current turn", default: true },
    showStatus: {
      type: "boolean",
      label: "Show turn status",
      description: "A dot on the reply when its turn is running, failed or was interrupted.",
      default: true,
    },
    showPosition: {
      type: "boolean",
      label: "Show turn counter",
      description: "Which of the thread's turns the pinned message is, like 7/23. Loads the whole thread.",
      default: true,
    },
    showFullText: {
      type: "boolean",
      label: "Show full text on hover",
      description: "A tooltip with the whole message when the bar had to cut it short.",
      default: true,
    },
    showPinButton: {
      type: "boolean",
      label: "Show the pin button",
      description: "The thread header button that opens the Pinned Turns menu. Switch this back on here if you hid it.",
      default: true,
    },
    debugLog: {
      type: "boolean",
      label: "Debug log",
      description: "Write timeline fetch timing to the plugin log (`bb plugin logs pinned-turns`).",
      default: false,
    },
  });
  bb.rpc.register(rpcContract, {
    set_setting: async ({ key, value }) => {
      await settings.experimental_set({ [key]: value });
      return null;
    },
    debug: async ({ event, data }) => {
      if (!(await settings.get()).debugLog) return null;
      bb.log.debug(`${event} ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" ")}`);
      return null;
    },
  });
  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
