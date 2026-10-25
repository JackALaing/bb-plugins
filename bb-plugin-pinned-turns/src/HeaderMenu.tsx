import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as Icon, useRpc } from "@get-bb/plugin-sdk/app";
import type { SettingKey, rpcContract } from "../server";
import { useOptions } from "./options";
import { usePortalScopeProps } from "./portal-scope";

const ITEMS: { key: SettingKey; label: string; hint?: string }[] = [
  { key: "showStatus", label: "Turn status", hint: "Pulse a running reply; mark one that failed or was interrupted" },
  { key: "showPosition", label: "Message position", hint: "Show 7/23 beside your message" },
  { key: "showFullText", label: "Full text on hover", hint: "When the bar cuts a message short" },
];

/** Where this plugin's settings live in BB. */
const SETTINGS_PATH = "/settings/plugins/pinned-turns";

/**
 * Opens a BB route in place. The SDK has no call for plugin settings, so this pushes
 * the route and tells BB's router; a plain link would reload the page.
 */
function openSettings() {
  history.pushState(null, "", SETTINGS_PATH);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

/**
 * The thread header's pin button. It opens the menu where the bar is switched on
 * and off and its options are set; each choice is a plugin setting, written
 * through the backend because the page can only read them.
 */
export function HeaderMenu() {
  const rpc = useRpc<typeof rpcContract>();
  const saved = useOptions();
  // Shown until the saved value arrives, so a click answers at once.
  const [pending, setPending] = useState<Partial<Record<SettingKey, boolean>>>({});
  useEffect(() => {
    setPending((now) => {
      const next = { ...now };
      for (const key of Object.keys(now) as SettingKey[]) if (saved[key] === now[key]) delete next[key];
      return Object.keys(next).length === Object.keys(now).length ? now : next;
    });
  }, [saved.enabled, saved.showStatus, saved.showPosition, saved.showFullText, saved.debugLog, saved.showPinButton]);
  const value = (key: SettingKey) => pending[key] ?? saved[key];
  const set = (key: SettingKey, next: boolean) => {
    setPending((now) => ({ ...now, [key]: next }));
    rpc.call("set_setting", { key, value: next }).catch(() =>
      setPending((now) => {
        const { [key]: _dropped, ...rest } = now;
        return rest;
      }),
    );
  };
  const on = value("enabled");
  const scope = usePortalScopeProps();

  // Hidden for good until the setting is switched back on in the plugin's settings.
  if (!saved.showPinButton) return null;

  return (
    // Not modal: a modal menu hides and locks the rest of the page on open, which cost
    // ~165ms here for five switches that need no focus trap.
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          title="Pinned turns"
          aria-label="Pinned turns settings"
          className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-recessed data-[state=open]:bg-surface-recessed ${on ? "text-foreground" : "text-muted-foreground"}`}
        >
          <Icon name={on ? "Pin" : "PinOff"} fallback="Pin" className="h-4 w-4" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          {...scope}
          align="end"
          sideOffset={6}
          className="z-50 min-w-[16rem] rounded-lg border border-border-seam bg-background p-1 text-sm text-foreground shadow-lg outline-none"
        >
          <Row checked={on} onChange={(next) => set("enabled", next)} label="Pin the current turn" />
          <Menu.Separator className="my-1 h-px bg-border-seam" />
          {ITEMS.map(({ key, label, hint }) => (
            <Row key={key} checked={value(key)} onChange={(next) => set(key, next)} label={label} hint={hint} disabled={!on} />
          ))}
          <Menu.Separator className="my-1 h-px bg-border-seam" />
          <Row checked={value("debugLog")} onChange={(next) => set("debugLog", next)} label="Debug log" hint="bb plugin logs pinned-turns" />
          <Row
            checked={value("showPinButton")}
            onChange={(next) => set("showPinButton", next)}
            label="Show this button"
            hint="Hidden, it comes back in the plugin's settings"
          />
          <Menu.Separator className="my-1 h-px bg-border-seam" />
          <Menu.Item
            onSelect={openSettings}
            className="relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-8 pr-3 outline-none data-[highlighted]:bg-surface-recessed"
          >
            <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center">
              <Icon name="Settings" fallback="Pin" className="h-4 w-4" aria-hidden />
            </span>
            Plugin settings
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Row({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <Menu.CheckboxItem
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      // Keep the menu open: these are switches, and several are set in one visit.
      onSelect={(event) => event.preventDefault()}
      className="relative flex cursor-pointer select-none flex-col rounded-md py-1.5 pl-8 pr-3 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-recessed"
    >
      <span className="absolute left-2.5 top-2 flex h-4 w-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Icon name="Check" className="h-4 w-4" aria-hidden />
        </Menu.ItemIndicator>
      </span>
      <span>{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </Menu.CheckboxItem>
  );
}
