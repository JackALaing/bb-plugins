import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { DOCK_ICON } from "./icons";
import { BUTTON_ATTR, setMenu, useMenu } from "./menu-state";
import { useOptions } from "./options";

/**
 * The dock button in the composer's action row, so it travels with the shell.
 * It only opens the menu, which `DockMenu` renders from the app overlay: see
 * `menu-state.ts` for why they are apart.
 */
export function DockButton() {
  const { ready, showButton, enabled } = useOptions();
  const { open } = useMenu();

  // Hidden for good until the setting is switched back on in the plugin's settings.
  if (!ready || !showButton) return null;

  return (
    <button
      type="button"
      title="Chat dock"
      aria-label="Chat dock settings"
      aria-haspopup="menu"
      aria-expanded={open}
      {...{ [BUTTON_ATTR]: "" }}
      // No focus on click: focus inside the composer expands it too.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => setMenu({ open: !open, anchor: event.currentTarget.getBoundingClientRect() })}
      className="chat-dock-button"
      data-off={enabled ? undefined : ""}
    >
      <Icon name={DOCK_ICON} fallback="PanelRight" className="chat-dock-icon" aria-hidden />
    </button>
  );
}
