import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as Icon, experimental_usePluginId as usePluginId, useRpc } from "@get-bb/plugin-sdk/app";
import type { SettingKey, rpcContract } from "../server";
import { BUTTON_ATTR, installButtonGuard, setMenu, useMenu } from "./menu-state";
import { useOptions } from "./options";
import { usePortalScopeProps } from "./portal-scope";

/**
 * Opens this plugin's page in BB's settings in place. The SDK has no call for it, so
 * this pushes the route and tells BB's router; a plain link would reload the page.
 */
function openSettings(pluginId: string) {
  history.pushState(null, "", `/settings/plugins/${pluginId}`);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

/**
 * The dock button's menu, rendered from the app overlay and hung from the
 * button's position (`menu-state.ts`). It switches the Chat tab, the lock and
 * the debug log; each is a plugin setting, written through the backend because
 * the page can only read them.
 */
export function DockMenu() {
  const { open, anchor } = useMenu();
  useEffect(installButtonGuard, []);
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

  if (!open || !anchor) return null;

  return (
    // Not modal: a modal menu hides and locks the rest of the page on open, for three switches that need no focus trap.
    <Menu.Root open onOpenChange={(next) => setMenu({ open: next })} modal={false}>
      {/* The anchor: an inert box over the button, since the button itself is in the composer's tree. */}
      <Menu.Trigger asChild>
        <div
          aria-hidden
          style={{ position: "fixed", left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height, pointerEvents: "none" }}
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          {...scope}
          align="start"
          side="top"
          sideOffset={8}
          // The button toggles the menu itself; as an outside click it would close and reopen it.
          onInteractOutside={(event) => {
            if (event.target instanceof Element && event.target.closest(`[${BUTTON_ATTR}]`)) event.preventDefault();
          }}
          // The anchor cannot take focus, and focusing the button would expand the composer.
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="chat-dock-menu"
        >
          <Row checked={on} onChange={(next) => set("enabled", next)} label="Dock the composer in the right panel" hint="While the panel is open" closes />
          <Row
            checked={value("locked")}
            onChange={(next) => set("locked", next)}
            label="Keep it at the panel's bottom"
            hint="Under whichever tab is open; off, a Chat tab of its own"
            disabled={!on}
          />
          <Menu.Separator className="chat-dock-separator" />
          <Row checked={value("debugLog")} onChange={(next) => set("debugLog", next)} label="Debug log" hint="bb plugin logs chat-dock" />
          <Row
            checked={value("showButton")}
            onChange={(next) => set("showButton", next)}
            label="Show this button"
            hint="Hidden, it comes back in the plugin's settings"
          />
          <Menu.Separator className="chat-dock-separator" />
          <Menu.Item
            onSelect={() => openSettings(pluginId)}
            className="chat-dock-item"
          >
            <span className="chat-dock-item-mark">
              <Icon name="Settings" fallback="PanelRight" className="chat-dock-icon" aria-hidden />
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
  closes,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** Close the menu on a toggle: the composer is about to move, so the menu would be left hanging. */
  closes?: boolean;
}) {
  return (
    <Menu.CheckboxItem
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      // Keep the menu open: these are switches, and several are set in one visit.
      onSelect={(event) => {
        if (!closes) event.preventDefault();
      }}
      className="chat-dock-item chat-dock-item--switch"
    >
      <span className="chat-dock-item-mark">
        <Menu.ItemIndicator>
          <Icon name="Check" className="chat-dock-icon" aria-hidden />
        </Menu.ItemIndicator>
      </span>
      <span>{label}</span>
      {hint ? <span className="chat-dock-hint">{hint}</span> : null}
    </Menu.CheckboxItem>
  );
}
