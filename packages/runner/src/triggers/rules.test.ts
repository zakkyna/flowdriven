import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import {
  checkEnable,
  inputsFromDefaults,
  payloadFiles,
  preflight,
  sanitizeText,
  triggerWords,
} from "./rules.ts";

afterEach(cleanup);
function manifest(over: Record<string, unknown> = {}) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "test.flow",
    name: "Test",
    kind: "build",
    triggers: [{ kind: "schedule", every: "1h" }],
    steps: [{ id: "a", do: "worker", instructions: "Say x", checks: [{ type: "contains", pattern: "x" }] }],
    ...over,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
}
function project() {
  const path = join(dirname(tempPath()), "project");
  mkdirSync(path);
  return path;
}
function check(m: ReturnType<typeof manifest>, projectDir: string, index = 0) {
  return checkEnable({
    manifest: m,
    files: {},
    index,
    projectDir,
    selfId: "test.flow",
    flowExists: (id) => id === "other.flow",
  });
}
const reason = (reason: string) => ({ ok: false, reason });
test("checkEnable accepts a schedule, a file_change inside the project and a flow_done for a flow that exists", () => {
  const dir = project();
  for (const trigger of [
    { kind: "schedule", every: "1h" },
    { kind: "file_change", path: "." },
    { kind: "flow_done", flow: "other.flow" },
  ])
    expect(check(manifest({ triggers: [trigger] }), dir)).toEqual({ ok: true });
  expect(check(manifest(), dir, 1)).toEqual(reason("There is no such trigger."));
});
test("checkEnable refuses a flow that fails R4, with the reason `This flow cannot run unattended: unattended prefix at steps.0`", () => {
  const m = manifest({
    requirements: [{ id: "mail", type: "mcp_server", ref: "mail", tools: ["SMSSend"] }],
    steps: [
      {
        id: "a",
        do: "worker",
        instructions: "Send",
        uses: ["mail"],
        checks: [{ type: "contains", pattern: "x" }],
      },
    ],
  });
  expect(check(m, project())).toEqual(
    reason("This flow cannot run unattended: unattended prefix at steps.0"),
  );
});
test("checkEnable refuses new_item, link and webhook as not available yet and manual as nothing to switch", () => {
  const dir = project();
  for (const trigger of [
    { kind: "new_item", source: "x", query: "x", every: "5m", key: "x" },
    { kind: "link" },
    { kind: "webhook", schema: "missing" },
  ])
    expect(check(manifest({ triggers: [trigger] }), dir)).toEqual(reason("Not available yet."));
  expect(check(manifest({ triggers: [{ kind: "manual" }] }), dir)).toEqual(
    reason("Run by hand. There is nothing to switch."),
  );
});
test("checkEnable refuses a required input without a default, a 30 second schedule, an empty days list, a path outside the project, a flow_done on itself and on a missing flow", () => {
  const dir = project();
  expect(
    check(manifest({ inputs: [{ id: "name", type: "text", label: "Name", required: true }] }), dir),
  ).toEqual(reason('Input "name" is required and has no default, so a trigger cannot start this flow.'));
  for (const [trigger, message] of [
    [{ kind: "schedule", every: "30s" }, "The shortest schedule is every 1 minute."],
    [{ kind: "schedule", every: "1h", days: [] }, "No days are selected."],
    [{ kind: "file_change", path: ".." }, "Only folders inside the project folder can be watched for now."],
    [{ kind: "file_change", path: "" }, "That file pattern is too long or too complex."],
    [
      { kind: "file_change", path: `a${String.fromCodePoint(0)}` },
      "That file pattern is too long or too complex.",
    ],
    [
      { kind: "file_change", path: ".", glob: "x".repeat(201) },
      "That file pattern is too long or too complex.",
    ],
    [
      { kind: "file_change", path: ".", glob: "**/".repeat(9) },
      "That file pattern is too long or too complex.",
    ],
    [{ kind: "flow_done", flow: "test.flow" }, "A flow cannot start itself."],
    [{ kind: "flow_done", flow: "missing.flow" }, 'The flow "missing.flow" is not on this Mac.'],
  ] as const)
    expect(check(manifest({ triggers: [trigger] }), dir)).toEqual(reason(message));
});
test("inputsFromDefaults fills declared defaults and fails on a required input with none", () => {
  const inputs = [
    { id: "name", type: "text", label: "Name", default: "Ada" },
    { id: "count", type: "number", label: "Count", default: 0 },
    { id: "yes", type: "bool", label: "Yes", default: false },
    { id: "list", type: "list<text>", label: "List", default: ["a", "b"] },
    { id: "optional", type: "text", label: "Optional" },
  ];
  expect(inputsFromDefaults(manifest({ inputs }))).toEqual({
    ok: true,
    inputs: { name: "Ada", count: 0, yes: false, list: ["a", "b"] },
  });
  expect(
    inputsFromDefaults(manifest({ inputs: [{ id: "name", type: "text", label: "Name", required: true }] })),
  ).toEqual(reason('Input "name" is required and has no default, so a trigger cannot start this flow.'));
});
test("preflight decides in order: needs_ok, refused, cap, skip, queue full, ok, and says whether the fire is consumed", () => {
  const base = {
    enabled: true,
    hashOk: true,
    r4Errors: [] as string[],
    runsToday: 0,
    cap: 24,
    open: 0,
    queued: 0,
    overlap: "skip" as const,
  };
  for (const [change, outcome, consume] of [
    [{ enabled: false, hashOk: false, r4Errors: ["bad"] as string[], runsToday: 24 }, "needs_ok", false],
    [{ hashOk: false }, "needs_ok", false],
    [{ r4Errors: ["x".repeat(250)] as string[], runsToday: 24 }, "refused", true],
    [{ runsToday: 24, open: 1 }, "dropped_cap", true],
    [{ open: 1, queued: 2 }, "skipped_overlap", true],
    [{ open: 1, queued: 2, overlap: "queue" as const }, "dropped_queue_full", false],
  ] as const) {
    const result = preflight({ ...base, ...change });
    expect(result).toMatchObject({ ok: false, outcome, consume });
    if (!result.ok && outcome === "refused") expect(result.detail).toBe("x".repeat(200));
  }
  expect(preflight(base)).toEqual({ ok: true });
  expect(preflight({ ...base, overlap: "queue", open: 1, queued: 1 })).toEqual({ ok: true });
});
test("a hostile flow name loses control, bidi and zero-width characters, collapses spaces and is cut at 60 characters", () => {
  const hostile = `  Ab${String.fromCodePoint(0x202e, 0x200b, 0x0007, 0x2028)}  ${"x".repeat(80)} `;
  expect(triggerWords("flow_done", { flow: "id" }, () => hostile)).toBe(
    `Started after Ab ${"x".repeat(54)}...`,
  );
});
test("sanitizeText cuts by code points and never splits a surrogate pair", () => {
  const emoji = String.fromCodePoint(0x1f600);
  expect(sanitizeText(`ab${emoji}cdef`, 6)).toBe(`ab${emoji}...`);
});
test("payloadFiles caps the count and the length and drops names that sanitise to nothing", () => {
  expect(payloadFiles([String.fromCodePoint(0x200b), "x".repeat(205), "last"], 2)).toEqual([
    `${"x".repeat(197)}...`,
  ]);
});
test("triggerWords gives plain words for each kind and nothing for manual", () => {
  const name = (id: string) => (id === "f" ? "Flow" : undefined);
  expect(triggerWords("schedule", undefined, name)).toBe("Started by its schedule");
  expect(triggerWords("schedule", { missed: 3 }, name)).toBe(
    "Started by its schedule, catching up on 3 missed",
  );
  expect(triggerWords("file_change", undefined, name)).toBe("Started by a change in the watched folder");
  expect(triggerWords("flow_done", { flow: "f" }, name)).toBe("Started after Flow");
  expect(triggerWords("flow_done", { flow: "other" }, name)).toBe("Started after other");
  expect(triggerWords("manual", undefined, name)).toBeUndefined();
  expect(triggerWords("unknown", undefined, name)).toBeUndefined();
});
