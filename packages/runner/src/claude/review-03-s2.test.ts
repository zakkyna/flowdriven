// Belongs in packages/runner/src/claude/review-03-s2.test.ts
// S2: a protected name spelled with a character that the default macOS volume folds to ASCII (U+017F LATIN SMALL
// LETTER LONG S folds to "s") is not caught by fold(), and the file it creates IS the protected file.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { DENY, decide } from "./decide.ts";
import type { Policy } from "./policy.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
test("S2 Write of .mcp.j<U+017F>on is protected, because the volume treats it as .mcp.json", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const notes = join(root, "notes");
  mkdirSync(notes);
  const policy: Policy = {
    tools: ["Read", "Glob", "Grep", "Write", "Edit"],
    folders: [{ path: notes, write: true }],
    cwd: notes,
    addDirs: [],
    schema: false,
    sessionId: "s1",
  };
  const spelled = join(notes, `.mcp.j${String.fromCodePoint(0x17f)}on`);
  // What the write would do on this volume: the file it creates answers to the protected name.
  const probe = join(root, `probe.j${String.fromCodePoint(0x17f)}on`);
  writeFileSync(probe, "x");
  const folds = existsSync(join(root, "probe.json"));
  const result = decide(policy, {
    hook_event_name: "PreToolUse",
    session_id: "s1",
    tool_name: "Write",
    tool_input: { file_path: spelled, content: "{}" },
    tool_use_id: "t1",
  });
  expect({ folds, result }).toEqual({
    folds: true,
    result: { allow: false, outcome: "refuse", tool: "Write", reason: DENY.protectedPath, target: spelled },
  });
});
