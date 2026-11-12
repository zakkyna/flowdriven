import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTemplate, Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import type { Routed } from "../router/types.ts";
import { buildPolicy } from "./policy.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const project = join(root, "project");
  const controlRoot = join(root, "control");
  mkdirSync(project);
  mkdirSync(controlRoot);
  return {
    kind: "worker" as const,
    project,
    controlRoot,
    controlCwd: join(controlRoot, "cwd"),
    sessionId: "s1",
    schema: false,
  };
}
const source = "https://www.upwork.com/jobs/~{id:[0-9a-z]{18,24}}";
const web = Requirement.parse({
  id: "web",
  type: "web",
  mode: "read",
  session: "own",
  url_patterns: [source],
});
const route: Routed = {
  routed: true,
  requirementId: "web",
  type: "web",
  provider: "claude-in-chrome",
  providerName: "Chrome",
  enforcedBy: "FlowDriven hook in Claude Code",
  label: "unofficial",
  away: true,
};
test("a routed, read, own web requirement gives a browser policy with its templates and the default rates, and no extra built-in tool; with a path requirement too the folders and tools are as before and the browser is added", () => {
  const o = setup();
  const parsed = parseTemplate(source);
  if (!parsed.ok) throw new Error("Bad test template");
  const browser = { requirementId: "web", templates: [parsed.template], perRun: 3, perDay: 10 };
  expect(buildPolicy({ ...o, requirements: [web], routes: [route] })).toMatchObject({
    browser,
    tools: [],
    folders: [],
  });
  const path = Requirement.parse({ id: "path", type: "path", access: "read" });
  expect(buildPolicy({ ...o, requirements: [path, web], routes: [route] })).toMatchObject({
    browser,
    tools: ["Read", "Glob", "Grep"],
    folders: [{ path: o.project, write: false }],
  });
});
test("no stored route, a dropped route, mode act, session managed, no template, a host outside domains, a second web requirement and an unparsable template each throw the present sentence", () => {
  const o = setup();
  const dropped: Routed = { routed: false, requirementId: "web", type: "web", noun: "Web", reason: "no" };
  const cases = [
    { requirements: [web], routes: undefined },
    { requirements: [web], routes: [dropped] },
    ...[
      { ...web, mode: "act" as const },
      { ...web, session: "managed" as const },
      { ...web, url_patterns: [] },
      { ...web, domains: ["other.example"] },
      { ...web, url_patterns: ["invalid"] },
    ].map((req) => ({ requirements: [req], routes: [route] })),
    { requirements: [web, web], routes: [route] },
  ];
  for (const item of cases)
    expect(() => buildPolicy({ ...o, ...item })).toThrow(
      "This step uses something FlowDriven cannot enforce yet (web).",
    );
});
