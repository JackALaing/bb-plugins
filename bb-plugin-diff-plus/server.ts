// bb-plugin-diff-plus — backend entry.
//
// Reads the changed files for the tree from BB's Git plugin (`bb--git`). The call
// is made here rather than in the page because it needs a zod schema for the
// answer, and zod is not shared with the page: it would be bundled into app.js.
// Everything else is in the page (app.tsx).
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const target = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommitted") }),
  z.object({ type: z.literal("all"), mergeBaseBranch: z.string().min(1) }),
  z.object({ type: z.literal("branch_committed"), mergeBaseBranch: z.string().min(1) }),
  z.object({ type: z.literal("commit"), sha: z.string().min(1) }),
]);

/** The part of `bb--git`'s `files` answer the tree reads; zod drops the rest. */
const files = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("available"),
    truncated: z.boolean(),
    files: z.array(
      z.object({
        path: z.string(),
        previousPath: z.string().nullable(),
        changeKind: z.enum(["added", "modified", "deleted", "renamed", "copied", "type_changed"]),
        additions: z.number(),
        deletions: z.number(),
        origin: z.enum(["tracked", "untracked"]),
      }),
    ),
  }),
  z.object({ outcome: z.literal("not_applicable"), message: z.string() }),
  z.object({ outcome: z.literal("unavailable"), failure: z.object({ message: z.string() }) }),
]);

export const rpcContract = defineRpcContract({
  files: { input: z.object({ environmentId: z.string().min(1), target }), output: files },
});

export default async function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    files: (input) =>
      bb.sdk.plugins.callRpc({
        pluginId: "bb--git",
        method: "files",
        input: { ...input, ignoreWhitespace: false },
        outputSchema: files,
      }),
  });
  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
