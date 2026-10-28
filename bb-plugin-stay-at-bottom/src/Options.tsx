import { useEffect } from "react";
import { useSettings } from "@get-bb/plugin-sdk/app";
import { setEnabled } from "./keeper";

/**
 * Renders nothing. A content script has no React and so no `useSettings()`;
 * this overlay, mounted on every page, reads the setting and hands it to the
 * keeper through a module variable (both are in one bundle). Until the saved
 * settings arrive the keeper is on, its default.
 */
export function Options() {
  const { values, isLoading } = useSettings();
  const enabled = isLoading || typeof values?.enabled !== "boolean" ? true : values.enabled;
  useEffect(() => {
    setEnabled(enabled);
  }, [enabled]);
  return null;
}
