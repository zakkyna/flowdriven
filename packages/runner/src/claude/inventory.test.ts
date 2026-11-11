import { chmodSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  FAKE_CLAUDE_PATH,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { listSkills, parseMcp, parsePlugins, readInventory } from "./inventory.ts";
import { visible } from "./text.ts";

const homes: string[] = [];
function home() {
  const h = makeFakeHome();
  homes.push(h);
  return h;
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
function skill(root: string, name: string) {
  const d = join(root, ".claude/skills", name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "SKILL.md"), "unread");
  return d;
}
test("skills are folders that hold SKILL.md, from the user and the project, and the file is not read", () => {
  const h = home();
  const project = join(h, "project");
  const d = skill(h, "zeta");
  chmodSync(join(d, "SKILL.md"), 0o000);
  skill(project, "alpha");
  mkdirSync(join(h, ".claude/skills/empty"));
  symlinkSync(d, join(h, ".claude/skills/link"));
  expect(listSkills({ home: h, project })).toEqual([
    { name: "alpha", scope: "project" },
    { name: "link", scope: "user" },
    { name: "zeta", scope: "user" },
  ]);
});
test("plugins: only the enabled ones, named by their id", () => {
  expect(
    parsePlugins(
      JSON.stringify([
        { id: "design@market", enabled: true },
        { id: "project@market", enabled: true, scope: "project" },
        { id: "other@market", enabled: true, scope: "other" },
        { id: "old@market", enabled: false },
        { id: 42, enabled: true },
        null,
      ]),
    ),
  ).toEqual([
    { name: "design@market", scope: "user" },
    { name: "project@market", scope: "project" },
    { name: "other@market", scope: "user" },
  ]);
  expect(parsePlugins("{}")).toEqual([]);
  expect(parsePlugins("bad")).toEqual([]);
});
test("MCP lines", () => {
  const check = String.fromCodePoint(0x2714);
  const lines = [
    "Checking MCP server health...",
    "",
    "garbage",
    "claude.ai Gmail: https://x.test/mcp (HTTP) - ! Needs authentication",
    `plugin:design:google calendar: npx -y pkg - x - ${check} Connected`,
    "my - server: node s.js - Failed to connect",
    "notes: node n.js - Not configured",
  ];
  expect(parseMcp(lines.join("\n"))).toEqual([
    { name: "claude.ai Gmail", scope: "user", source: "claude.ai", connection: "needs_login" },
    { name: "plugin:design:google calendar", scope: "user", source: "plugin", connection: "connected" },
    { name: "my - server", scope: "user", source: "config", connection: "failed" },
    { name: "notes", scope: "user", source: "config" },
  ]);
});
test("a target is never kept", () => {
  expect(JSON.stringify(parseMcp("notes: https://x.test/?token=SECRET - Connected"))).not.toContain("SECRET");
});
test("visible shows hidden characters, and the caps hold", () => {
  const hidden = String.fromCodePoint(0x202e);
  expect(visible(`a${hidden}b`, 120)).toBe("a<U+202E>b");
  expect(visible("x".repeat(130), 120)).toBe("x".repeat(120));
  expect(visible(`${"x".repeat(119)}${hidden}`, 120)).toBe("x".repeat(119));
  const h = home();
  for (let i = 0; i < 250; i++) skill(h, `skill${i}`);
  expect(listSkills({ home: h })).toHaveLength(200);
  expect(
    parsePlugins(
      JSON.stringify(Array.from({ length: 250 }, () => ({ id: "x".repeat(130), enabled: true }))),
    ).at(0)?.name,
  ).toHaveLength(120);
  expect(
    parsePlugins(JSON.stringify(Array.from({ length: 250 }, () => ({ id: "a", enabled: true })))).length,
  ).toBe(200);
});
test("readInventory runs mcp list only when asked", { timeout: 20_000 }, async () => {
  const h = home();
  const options = { claude: FAKE_CLAUDE_PATH, cwd: h, env: { HOME: h, PATH: process.env.PATH } };
  const first = await readInventory({ ...options, withMcp: false });
  expect(first).not.toHaveProperty("mcpServers");
  expect(readFakeCalls(h).some((c) => c.kind === "call" && c.args[0] === "mcp")).toBe(false);
  const second = await readInventory({ ...options, withMcp: true });
  expect(second.mcpServers).toEqual([
    { name: "claude.ai Gmail", scope: "user", source: "claude.ai", connection: "needs_login" },
  ]);
  writeFakeScript(h, { hang: ["mcp"] });
  expect(await readInventory({ ...options, withMcp: true, mcpTimeoutMs: 300 })).not.toHaveProperty(
    "mcpServers",
  );
  const calls = readFakeCalls(h).filter((c) => c.kind === "call");
  expect(calls.map((c) => c.args)).toEqual(
    expect.arrayContaining([
      ["plugin", "list", "--json"],
      ["mcp", "list"],
    ]),
  );
  for (const call of calls) expect(call.cwd).toBe(realpathSync(h));
});
