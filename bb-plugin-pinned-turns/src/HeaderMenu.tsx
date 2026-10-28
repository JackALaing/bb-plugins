import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as Icon, experimental_usePluginId as usePluginId, useRpc } from "@get-bb/plugin-sdk/app";
import type { SettingKey, rpcContract } from "../server";
import { useOptions } from "./options";
import { usePortalScopeProps } from "./portal-scope";
import { useCanHover, useCounterRoom } from "./viewport";

const ITEMS: { key: SettingKey; label: string; hint?: string }[] = [
  { key: "showStatus", label: "Turn status", hint: "Pulse a running turn; mark a reply that failed or was interrupted" },
  { key: "showPosition", label: "Turn counter", hint: "Show 7/23 beside your message" },
  { key: "showFullText", label: "Full text on hover", hint: "When the bar cuts a message short" },
];

/**
 * Opens this plugin's page in BB's settings in place. The SDK has no call for it, so
 * this pushes the route and tells BB's router; a plain link would reload the page.
 */
function openSettings(pluginId: string) {
  history.pushState(null, "", `/settings/plugins/${pluginId}`);
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
  const pluginId = usePluginId();
  // Shown until the saved value arrives, so a click answers at once.
  const [pending, setPending] = useState<Partial<Record<SettingKey, boolean>>>({});
  useEffect(() => {
    setPending((now) => {
      const next = { ...now };
      for (const key of Object.keys(now) as SettingKey[]) if (saved[key] === now[key]) delete next[key];
      return Object.keys(next).length === Object.keys(now).length ? now : next;
    });
  }, [saved]);
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
  // Options that cannot do anything here are greyed out, with the reason in place of the hint.
  const unavailable: Partial<Record<SettingKey, string>> = {};
  if (!useCounterRoom()) unavailable.showPosition = "Not shown when the thread is this narrow";
  if (!useCanHover()) unavailable.showFullText = "Needs a pointer that can hover";

  // Hidden for good until the setting is switched back on in the plugin's settings.
  if (!saved.ready || !saved.showPinButton) return null;

  return (
    // Not modal: a modal menu hides and locks the rest of the page on open, which cost
    // ~165ms here for five switches that need no focus trap.
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          title="Pinned turns"
          aria-label="Pinned turns settings"
          className="pinned-trigger"
          data-on={on ? "" : undefined}
        >
          <Icon name={on ? "Pin" : "PinOff"} fallback="Pin" className="pinned-icon" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          {...scope}
          align="end"
          sideOffset={6}
          className="pinned-menu"
        >
          <Row checked={on} onChange={(next) => set("enabled", next)} label="Pin the current turn" />
          <Menu.Separator className="pinned-separator" />
          {ITEMS.map(({ key, label, hint }) => (
            <Row
              key={key}
              checked={value(key)}
              onChange={(next) => set(key, next)}
              label={label}
              hint={unavailable[key] ?? hint}
              disabled={!on || key in unavailable}
            />
          ))}
          <Menu.Separator className="pinned-separator" />
          <Row checked={value("debugLog")} onChange={(next) => set("debugLog", next)} label="Debug log" hint="bb plugin logs pinned-turns" />
          <Row
            checked={value("showPinButton")}
            onChange={(next) => set("showPinButton", next)}
            label="Show this button"
            hint="Hidden, it comes back in the plugin's settings"
          />
          <Menu.Separator className="pinned-separator" />
          <Menu.Item
            onSelect={() => openSettings(pluginId)}
            className="pinned-item"
          >
            <span className="pinned-item-mark">
              <Icon name="Settings" fallback="Pin" className="pinned-icon" aria-hidden />
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
      className="pinned-item pinned-item--switch"
    >
      <span className="pinned-item-mark">
        <Menu.ItemIndicator>
          <Icon name="Check" className="pinned-icon" aria-hidden />
        </Menu.ItemIndicator>
      </span>
      <span>{label}</span>
      {hint ? <span className="pinned-hint">{hint}</span> : null}
    </Menu.CheckboxItem>
  );
}
