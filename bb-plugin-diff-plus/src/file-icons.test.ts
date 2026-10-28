import { test } from "node:test";
import assert from "node:assert/strict";
import { fileIcon, folderIcon } from "./file-icons.ts";

test("a file name wins over its extension", () => {
  assert.equal(fileIcon("bb-plugin-diff-plus/package.json"), "npm");
  assert.equal(fileIcon("tsconfig.json"), "tsconfig");
  assert.equal(fileIcon("AGENTS.md"), "agents");
});

test("the longest dotted extension wins", () => {
  assert.equal(fileIcon("src/folders.test.ts"), "testts");
  assert.equal(fileIcon("types/sdk.d.ts"), "typescriptdef");
  assert.equal(fileIcon("src/folders.ts"), "typescript");
});

test("languages fill what the theme maps only through them", () => {
  assert.equal(fileIcon("src/Tree.tsx"), "reactts");
  assert.equal(fileIcon("README.md"), "markdown");
  assert.equal(fileIcon("docs/index.mdx"), "mdx");
  assert.equal(fileIcon("Dockerfile"), "docker");
  assert.equal(fileIcon("apps/web/.env"), "dotenv");
  assert.equal(fileIcon("apps/web/.env.production"), "dotenv");
});

test("names are matched without case", () => {
  assert.equal(fileIcon("PACKAGE.JSON"), "npm");
  assert.equal(fileIcon("src/Main.TS"), "typescript");
});

test("anything else is a plain file, including names on Object.prototype", () => {
  assert.equal(fileIcon("LICENSE.unknownext"), "file");
  assert.equal(fileIcon("constructor"), "file");
  assert.equal(fileIcon("a.constructor"), "file");
  assert.equal(fileIcon("Makefile"), "file");
});

test("folders take their name's icon, open or closed", () => {
  assert.equal(folderIcon("src", false), "folder-src");
  assert.equal(folderIcon("bb-plugin-diff-plus/src", true), "folder-src-open");
  assert.equal(folderIcon("Tests", false), "folder-test");
  assert.equal(folderIcon("docs/content/docs", false), "folder-docs");
  assert.equal(folderIcon("whatever", false), "folder");
  assert.equal(folderIcon("whatever", true), "folder-open");
  assert.equal(folderIcon("toString", false), "folder");
});

test("a name that is both a file and a folder icon keeps them apart", () => {
  assert.equal(fileIcon("settings.ini"), "ini");
  assert.equal(fileIcon("app.properties"), "config");
  assert.equal(folderIcon("config", false), "folder-config");
});
