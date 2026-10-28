// bb-plugin-diff-plus — frontend entry.
//
// Adds a folder tree beside the Diff tab's file list (src/Tree.tsx). BB has no
// slot there, so an app overlay finds the tab in the page and portals into it.
// BB's diffs themselves are left alone: quoting selected lines is BB's own
// "Add to chat".
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TreeOverlay } from "./src/Tree";
import "./src/styles.css";
import "./src/icons.css";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "tree", component: TreeOverlay });
});
