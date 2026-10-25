import { useSettings } from "@get-bb/plugin-sdk/app";
import type { SettingKey } from "../server";

/** What a setting is until the server says otherwise; the same defaults as `server.ts`. */
export const DEFAULTS: Record<SettingKey, boolean> = {
  enabled: true,
  showStatus: true,
  showPosition: true,
  showFullText: true,
  debugLog: true,
};

/** The saved settings, with the defaults filling anything not yet loaded. */
export function useOptions(): Record<SettingKey, boolean> {
  const { values } = useSettings();
  const read = (key: SettingKey) => (typeof values?.[key] === "boolean" ? (values[key] as boolean) : DEFAULTS[key]);
  return {
    enabled: read("enabled"),
    showStatus: read("showStatus"),
    showPosition: read("showPosition"),
    showFullText: read("showFullText"),
    debugLog: read("debugLog"),
  };
}
