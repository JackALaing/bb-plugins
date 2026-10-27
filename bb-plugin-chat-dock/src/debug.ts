import { useRef } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { useOptions } from "./options";

export type Debug = (event: string, data: Record<string, string | number | boolean>) => void;

/** A logger for the plugin log; a stable ref, so effects need not re-run when the setting flips. */
export function useDebug(): { current: Debug } {
  const rpc = useRpc<typeof rpcContract>();
  const { debugLog } = useOptions();
  const log = useRef<Debug>(() => {});
  // The server drops these unless the debug log is on; skipping the call here saves the round trip.
  log.current = (event, data) => {
    if (debugLog) rpc.call("debug", { event, data }).catch(() => {});
  };
  return log;
}
