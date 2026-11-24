import { expect, test, vi } from "vitest";
import { buildClaudeArgs, workerSettings } from "./args.ts";
import { decide } from "./decide.ts";
import { settingsJson } from "./hook-script.ts";
import type { Policy } from "./policy.ts";
import * as policyModule from "./policy.ts";

test("TC-SR4-07 model choice preserves arguments, settings and decisions", () => {
  const input = {
    sessionId: "s",
    tools: ["Read", "Write", "Bash"],
    settingsPath: "/control/settings.json",
    addDirs: ["/app-sources", "/builds-out"],
  };
  const a = buildClaudeArgs({ ...input, model: "sonnet-5.5" });
  const b = buildClaudeArgs({ ...input, model: "haiku-5.5" });
  const modelIndex = a.indexOf("--model");
  expect(a.toSpliced(modelIndex, 2)).toEqual(b.toSpliced(modelIndex, 2));
  const settings = { hooks: { PreToolUse: [{ matcher: "*" }] } };
  expect(workerSettings(settings, { settings: { autoMemoryEnabled: false } })).toEqual({
    ...settings,
    autoMemoryEnabled: false,
  });
  const policy: Policy = {
    tools: input.tools,
    folders: [],
    cwd: "/",
    addDirs: input.addDirs,
    schema: false,
    sessionId: "s",
    touches: [],
  };
  const call = {
    hook_event_name: "PreToolUse",
    session_id: "s",
    tool_name: "WebFetch",
    tool_input: { url: "https://example.test/" },
    tool_use_id: "t",
  };
  expect(decide(policy, call)).toMatchObject({ outcome: "hold", held: { outsideFlow: true } });
  expect(settingsJson("/control/cc-1").replaceAll("cc-1", "cc-id")).toBe(
    settingsJson("/control/cc-2").replaceAll("cc-2", "cc-id"),
  );
  const postPolicy: Policy = {
    ...policy,
    tools: ["social.post"],
    declaredTools: [{ tool: "social.post", cover: "social.post" }],
    effectCatalog: [{ tool: "social.post", effect: "post", place: undefined }],
    touches: [
      {
        touchId: "post-note",
        effect: "post",
        matcher: "exact",
        fixedPlace: true,
        list: "asks_first",
        covers: ["social.post"],
      },
    ],
  };
  const post = { ...call, tool_name: "social.post", tool_input: { text: "Build ready" } };
  expect(decide(postPolicy, post)).toMatchObject({ outcome: "hold", effect: "post" });
});

test("TC-SR4-07 fake runs preserve limits across model choices", { timeout: 20_000 }, async () => {
  const { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls, writeFakeScript } = await import(
    "../test-helpers/fake-claude-script.ts"
  );
  const { Requirement } = await import("@flowdriven/sdk");
  const { routeRequirement } = await import("../router/route.ts");
  const { createClaudeAdapter } = await import("./adapter.ts");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-model-")));
  const home = makeFakeHome({ plays: [{ when: "", actions: [{ do: "result" }] }] });
  try {
    const project = join(root, "project");
    mkdirSync(join(project, "sources"), { recursive: true });
    mkdirSync(join(project, "builds"));
    writeFakeScript(home, {
      plays: [
        {
          when: "",
          actions: [
            {
              do: "tool",
              id: "read",
              name: "Read",
              input: { file_path: join(project, "sources", "main.dart") },
            },
            {
              do: "tool",
              id: "write",
              name: "Write",
              input: { file_path: join(project, "builds", "app.apk"), content: "x" },
            },
            { do: "tool", id: "build", name: "Bash", input: { command: "flutter build apk" } },
            { do: "tool", id: "web", name: "WebFetch", input: { url: "https://example.test/" } },
            { do: "result" },
          ],
        },
      ],
    });
    const adapter = createClaudeAdapter({
      claudePath: () => FAKE_CLAUDE_PATH,
      env: () => ({ HOME: home, PATH: process.env.PATH }),
      controlRoot: join(root, "control"),
      audit: () => {},
      recordRule: () => {},
      effectCatalog: [{ tool: "social.post", effect: "post", place: undefined }],
      newId: () => "cc-1",
      newSessionId: () => "session-1",
      confirmation: () => ({
        confirmation: {
          flowId: "example.build-apk",
          hash: "hash",
          onItsOwn: ["read-sources", "write-build", "build"],
          touches: [
            {
              id: "read-sources",
              sentence: "Read",
              effect: "read",
              rule: "runs_alone",
              covers: [],
              place: { kind: "folder", value: "app-sources", label: "Sources" },
            },
            {
              id: "write-build",
              sentence: "Write",
              effect: "local_write",
              rule: "runs_alone",
              covers: [],
              place: { kind: "folder", value: "builds-out", label: "Builds" },
            },
            {
              id: "build",
              sentence: "Build",
              effect: "run_command",
              rule: "runs_alone",
              covers: ["flutter build apk"],
              place: { kind: "command", value: "flutter build apk", label: "Build" },
            },
            {
              id: "post-note",
              sentence: "Post a note",
              effect: "post",
              rule: "asks_first",
              covers: ["social.post"],
            },
          ],
        },
        rules: [
          {
            id: "write-rule",
            flowId: "example.build-apk",
            touchId: "write-build",
            effect: "local_write",
            place: { kind: "folder", value: join(project, "builds"), label: "Builds" },
            state: "active",
            createdAt: "2026-11-22",
            createdBy: "confirm",
            sentence: "Write",
            uses: 0,
          },
          {
            id: "build-rule",
            flowId: "example.build-apk",
            touchId: "build",
            effect: "run_command",
            place: { kind: "command", value: "flutter build apk", label: "Build" },
            state: "active",
            createdAt: "2026-11-22",
            createdBy: "confirm",
            sentence: "Build",
            uses: 0,
          },
        ],
        source: "chat",
        earlierNo: false,
      }),
    });
    const requirements = [
      Requirement.parse({ id: "app-sources", type: "path", ref: "sources", access: "read" }),
      Requirement.parse({ id: "builds-out", type: "path", ref: "builds", access: "read_write" }),
      Requirement.parse({ id: "cli", type: "cli_tool", commands: ["flutter build apk"] }),
    ];
    const cli = requirements[2];
    if (!cli) throw new Error("Missing command requirement.");
    const route = routeRequirement(cli, { hooks: true, chrome: false });
    if (!route) throw new Error("Missing command route.");
    const controlSettings: string[] = [];
    const request = {
      runId: "r",
      stepId: "s",
      itemKey: "",
      attempt: 1,
      replan: false,
      kind: "worker" as const,
      title: "test",
      instructions: "test",
      uses: ["app-sources", "builds-out", "cli"],
      project,
      requirements,
      routes: [route],
      takesOutside: false,
      onStart: () =>
        controlSettings.push(readFileSync(join(root, "control", "cc-1", "settings.json"), "utf8")),
      outputs: [],
      maxDurationMs: 10000,
      signal: new AbortController().signal,
    };
    const policySpy = vi.spyOn(policyModule, "buildPolicy");
    try {
      const results = [];
      for (const model of ["sonnet-5.5", "haiku-5.5"])
        results.push(await adapter.runStep({ ...request, model }));
      expect(policySpy).toHaveBeenCalledTimes(2);
      const compiledA = policySpy.mock.results[0]?.value as Policy | undefined;
      const compiledB = policySpy.mock.results[1]?.value as Policy | undefined;
      expect(compiledA).toBeDefined();
      expect(compiledB).toEqual(compiledA);
      expect(compiledA).toMatchObject({
        flowId: "example.build-apk",
        tools: expect.arrayContaining(["Read", "Write", "Bash"]),
      });
      expect(results[0]).toMatchObject({ hold: { outsideFlow: true, tool: "WebFetch" } });
      expect(results[1]?.hold).toEqual(results[0]?.hold);
      expect(controlSettings).toHaveLength(2);
      expect(controlSettings[0]).toEqual(controlSettings[1]);
      expect(JSON.parse(controlSettings[0] ?? "{}")).toMatchObject({
        autoMemoryEnabled: false,
        hooks: { PreToolUse: expect.any(Array) },
      });
      const calls = readFakeCalls(home).filter((call) => call.kind === "call");
      expect(calls).toHaveLength(2);
      const [a, b] = calls;
      if (!a || !b) throw new Error("Missing fake calls.");
      const index = a.args.indexOf("--model");
      expect(a.args.slice(index, index + 2)).toEqual(["--model", "sonnet-5.5"]);
      expect(b.args.slice(index, index + 2)).toEqual(["--model", "haiku-5.5"]);
      expect(a.args.toSpliced(index, 2)).toEqual(b.args.toSpliced(index, 2));
      expect(readFakeCalls(home).filter((call) => call.kind === "init")).toHaveLength(2);
      expect(readFakeCalls(home).filter((call) => call.kind === "tool")).toEqual([
        ...["read", "write", "build"].map((id) => expect.objectContaining({ id, ran: true })),
        expect.objectContaining({ id: "web", ran: false }),
        ...["read", "write", "build"].map((id) => expect.objectContaining({ id, ran: true })),
        expect.objectContaining({ id: "web", ran: false }),
      ]);
      writeFakeScript(home, {
        plays: [
          {
            when: "",
            actions: [
              { do: "tool", id: "post", name: "social.post", input: { text: "Build ready" } },
              { do: "result" },
            ],
          },
        ],
      });
      const posts = [];
      for (const model of ["sonnet-5.5", "haiku-5.5"])
        posts.push(await adapter.runStep({ ...request, model }));
      expect(policySpy).toHaveBeenCalledTimes(4);
      expect(policySpy.mock.results[3]?.value).toEqual(policySpy.mock.results[2]?.value);
      expect(posts[0]?.hold).toMatchObject({ tool: "social.post", effect: "post" });
      expect(posts[1]?.hold).toEqual(posts[0]?.hold);
    } finally {
      policySpy.mockRestore();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
