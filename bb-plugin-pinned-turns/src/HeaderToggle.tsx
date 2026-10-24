import { useState } from "react";
import { experimental_Icon as Icon, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";

/** The thread header's on/off switch for the bar; the state is the `enabled` setting. */
export function HeaderToggle() {
  const rpc = useRpc<typeof rpcContract>();
  const { values } = useSettings();
  // Shown until the saved setting arrives, so the button answers at once.
  const [pending, setPending] = useState<boolean | null>(null);
  const saved = values?.enabled !== false;
  const on = pending ?? saved;
  const label = on ? "Hide pinned turns" : "Show pinned turns";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={() => {
        setPending(!on);
        rpc.call("set_enabled", { enabled: !on }).then(
          () => setPending(null),
          () => setPending(null),
        );
      }}
      className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-recessed ${on ? "text-foreground" : "text-muted-foreground"}`}
    >
      <Icon name={on ? "Pin" : "PinOff"} fallback="Pin" className="h-4 w-4" aria-hidden />
    </button>
  );
}
