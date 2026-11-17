import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { routeRequirement } from "../router/route.ts";
import type { Routed } from "../router/types.ts";
import { COMMAND_STOP } from "./commands.ts";
import { buildPolicy } from "./policy.ts";
import { buildPrompt } from "./prompt.ts";
import { checkFirstEvent } from "./stream.ts";

const cli = Requirement.parse({ id: "cli", type: "cli_tool", commands: ["git status"] });
const folder = Requirement.parse({ id: "folder", type: "path", access: "read" });
const found = routeRequirement(cli, { hooks: true, chrome: false });
if (!found?.routed) throw new Error("Missing route");
const route: Routed = found;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-")));
  roots.push(root);
  const project = join(root, "project");
  const controlRoot = join(root, "control");
  mkdirSync(project);
  mkdirSync(controlRoot);
  return {
    kind: "worker" as const,
    requirements: [cli, folder],
    routes: [route],
    project,
    controlRoot,
    controlCwd: controlRoot,
    sessionId: "s",
    schema: false,
    takesOutside: false,
  };
}
test("a step that reads outside text gets no commands: the policy throws COMMAND_STOP.outside, also when takesOutside is missing", () => {
  const o = setup();
  expect(() => buildPolicy({ ...o, takesOutside: true })).toThrow(COMMAND_STOP.outside);
  const { takesOutside: _, ...missing } = o;
  expect(() => buildPolicy(missing)).toThrow(COMMAND_STOP.outside);
});
test("a step with a web or connector requirement, or a sensitive one, gets no commands", () => {
  const o = setup();
  for (const extra of [
    { id: "web", type: "web", mode: "read" },
    { id: "mcp", type: "mcp_server", tools: ["read"] },
    { id: "secret", type: "path", sensitive: true },
  ])
    expect(() => buildPolicy({ ...o, requirements: [...o.requirements, Requirement.parse(extra)] })).toThrow(
      COMMAND_STOP.outside,
    );
});
test("a step with commands and no folder throws COMMAND_STOP.noFolder", () => {
  const o = setup();
  expect(() => buildPolicy({ ...o, requirements: [cli] })).toThrow(COMMAND_STOP.noFolder);
});
test("Bash is in the tools only when the step uses a routed cli_tool, and the start proof expects it then", () => {
  const o = setup();
  const p = buildPolicy(o);
  expect(p.tools).toContain("Bash");
  expect(p.commands).toEqual({ patterns: ["git status"] });
  expect(p.cwd).toBe(o.project);
  const event = {
    type: "system",
    subtype: "init",
    session_id: "s",
    tools: p.tools,
    mcp_servers: [],
    skills: [],
    slash_commands: [],
    permissionMode: "default",
  };
  const settings = { tools: p.tools, schema: false, sessionId: "s", started: true };
  expect(checkFirstEvent(event, settings).ok).toBe(true);
  expect(checkFirstEvent({ ...event, tools: p.tools.filter((t) => t !== "Bash") }, settings).ok).toBe(false);
  expect(buildPolicy({ ...o, requirements: [folder] }).tools).not.toContain("Bash");
  expect(() => buildPolicy({ ...o, routes: [] })).toThrow();
});
test("the prompt lists the command lines the step may run and the folder they run in", () => {
  const text = buildPrompt({
    instructions: "work",
    outputs: [],
    commands: { patterns: ["git status"], cwd: "/project" },
  });
  expect(text).toContain("git status");
  expect(text).toContain("/project");
});
