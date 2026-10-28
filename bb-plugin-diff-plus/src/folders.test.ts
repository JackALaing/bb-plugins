import { test } from "node:test";
import assert from "node:assert/strict";
import { ancestors, buildTree, filePattern, folderPattern, initialOpen, scopeOf, selectedBy, statusOf, type ChangeKind, type TreeDir, type TreeFile } from "./folders.ts";

const file = (path: string, additions = 1, deletions = 0): TreeFile => ({ path, previousPath: null, additions, deletions, changeKind: "modified", untracked: false });
const shape = (dir: TreeDir): unknown => ({
  name: dir.name,
  count: dir.count,
  dirs: dir.dirs.map(shape),
  files: dir.files.map((f) => f.path),
});

test("buildTree sums counts and lines and folds single-folder chains", () => {
  const tree = buildTree([
    file("README.md", 2, 1),
    file("apps/docs/content/a.mdx", 3),
    file("apps/docs/content/b.mdx", 1, 4),
    file("apps/web/src/page.tsx"),
    file("src/item10.ts"),
    file("src/item9.ts"),
  ]);
  assert.deepEqual(shape(tree), {
    name: "",
    count: 6,
    dirs: [
      {
        name: "apps",
        count: 3,
        dirs: [
          { name: "docs/content", count: 2, dirs: [], files: ["apps/docs/content/a.mdx", "apps/docs/content/b.mdx"] },
          { name: "web/src", count: 1, dirs: [], files: ["apps/web/src/page.tsx"] },
        ],
        files: [],
      },
      { name: "src", count: 2, dirs: [], files: ["src/item9.ts", "src/item10.ts"] },
    ],
    files: ["README.md"],
  });
  assert.equal(tree.additions, 9);
  assert.equal(tree.deletions, 5);
  assert.equal(tree.dirs[0]!.dirs[0]!.path, "apps/docs/content");
});

test("initialOpen opens breadth first within the budget", () => {
  const files = [file("a/x/1.ts"), file("a/x/2.ts"), file("a/y.ts"), file("b/1.ts"), file("b/2.ts"), file("c.ts")];
  const tree = buildTree(files);
  assert.deepEqual([...initialOpen(tree, 100)].sort(), ["a", "a/x", "b"]);
  // Root shows 3 rows; opening "a" adds 2, "b" adds 2: 7 > 6, so only "a".
  assert.deepEqual([...initialOpen(tree, 6)], ["a"]);
  assert.deepEqual([...initialOpen(tree, 3)], []);
});

test("scopeOf reads the scope picker's label", () => {
  assert.deepEqual(scopeOf("All changes"), { target: "all" });
  assert.deepEqual(scopeOf("Committed changes"), { target: "branch_committed" });
  assert.deepEqual(scopeOf("Uncommitted changes"), { target: "uncommitted" });
  assert.deepEqual(scopeOf("19c6a2ad Rename the price-stock service"), { target: "commit", sha: "19c6a2ad" });
  assert.equal(scopeOf("Something new"), null);
  assert.deepEqual(scopeOf("deadbeefcafe"), { target: "commit", sha: "deadbeefcafe" });
});

test("folderPattern and filePattern escape glob characters", () => {
  assert.equal(folderPattern("apps/docs"), "apps/docs/**");
  assert.equal(folderPattern("app/[slug]"), "app/\\[slug\\]/**");
  assert.equal(folderPattern("app/(marketing)"), "app/\\(marketing\\)/**");
  assert.equal(folderPattern("a,b"), "a?b/**");
  const files = [file("README.md"), file("docs/README.md"), file("src/a.ts"), file("app/[slug]/page.tsx")];
  assert.equal(filePattern("src/a.ts", files), "src/a.ts");
  // A plain filter matches anywhere in a path, so a path another file holds is written exactly.
  assert.equal(filePattern("README.md", files), "README.md/**");
  assert.equal(filePattern("docs/README.md", files), "docs/README.md");
  assert.equal(filePattern("app/[slug]/page.tsx", files), "app/\\[slug\\]/page.tsx/**");
  assert.equal(filePattern("old.ts", [file("old.ts"), { ...file("src/new.ts"), previousPath: "src/old.ts" }]), "old.ts/**");
});

test("selectedBy maps a filter back to a folder or a file", () => {
  const isFile = (path: string) => ["README.md", "app/[slug]/page.tsx"].includes(path);
  assert.deepEqual(selectedBy("apps/docs/**", isFile), { kind: "dir", path: "apps/docs" });
  assert.deepEqual(selectedBy("README.md", isFile), { kind: "file", path: "README.md" });
  assert.deepEqual(selectedBy("README.md/**", isFile), { kind: "file", path: "README.md" });
  assert.deepEqual(selectedBy(folderPattern("app/[slug]"), isFile), { kind: "dir", path: "app/[slug]" });
  assert.deepEqual(selectedBy("app/\\[slug\\]/page.tsx/**", isFile), { kind: "file", path: "app/[slug]/page.tsx" });
  assert.deepEqual(selectedBy("a?b/**", isFile), { kind: "dir", path: "a,b" });
  assert.equal(selectedBy("*.md", isFile), null);
  assert.equal(selectedBy("src/*/**", isFile), null);
  assert.equal(selectedBy("!*.test.ts", isFile), null);
  assert.equal(selectedBy("  ", isFile), null);
});

test("ancestors lists the folders that hold a path", () => {
  const tree = buildTree([file("apps/docs/content/a.mdx"), file("apps/web/src/page.tsx")]);
  assert.deepEqual(ancestors(tree, "apps/docs/content/a.mdx"), ["apps", "apps/docs/content"]);
  assert.deepEqual(ancestors(tree, "apps/web/src"), ["apps"]);
  assert.deepEqual(ancestors(tree, "README.md"), []);
});

test("letters and tones follow VS Code's git decorations", () => {
  const as = (changeKind: ChangeKind, untracked = false): TreeFile => ({ ...file("a.ts"), changeKind, untracked });
  assert.deepEqual(
    [as("modified"), as("added"), as("added", true), as("deleted"), as("renamed"), as("type_changed")].map((f) => statusOf(f).mark + statusOf(f).tone),
    ["Mmodified", "Aadded", "Uadded", "Ddeleted", "Radded", "Tmodified"],
  );
});

test("a folder's tone is its files' when they agree, modified when they do not", () => {
  const as = (path: string, changeKind: ChangeKind, untracked = false): TreeFile => ({ ...file(path), changeKind, untracked });
  const tree = buildTree([as("new/a.ts", "added"), as("new/b.ts", "added", true), as("gone/a.ts", "deleted"), as("mixed/a.ts", "added"), as("mixed/deep/b.ts", "deleted")]);
  const tone = (name: string) => tree.dirs.find((d) => d.name === name)?.tone;
  assert.equal(tone("new"), "added");
  assert.equal(tone("gone"), "deleted");
  assert.equal(tone("mixed"), "modified");
  assert.equal(tree.tone, "modified");
});
