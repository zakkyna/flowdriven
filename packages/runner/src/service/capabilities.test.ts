import { FlowCapabilities } from "@flowdriven/contracts";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { ALLOW_NOT_ROUTED, createCapabilities } from "./capabilities.ts";
import { wrapStore } from "./events.ts";
import { createRunnerService } from "./service.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const hash = `sha256:${"1".repeat(64)}`;
const hash2 = `sha256:${"2".repeat(64)}`;
const now = () => new Date("2026-11-12T00:00:00Z");
const web = (patterns = ["https://www.upwork.com/jobs/{job:[a-z]{1,20}}"]) => ({
  id: "web",
  type: "web",
  mode: "read",
  session: "own",
  url_patterns: patterns,
});
const base = (
  requirements: unknown[] = [
    web(),
    { id: "path", type: "path", ref: "notes" },
    { id: "skill", type: "skill" },
    { id: "cli", type: "cli_tool" },
    { id: "harness", type: "harness" },
  ],
  extra: object = {},
) =>
  FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Secret name",
    kind: "light",
    steps: [{ id: "worker", do: "worker", instructions: "Secret instructions", uses: ["web"] }],
    requirements,
    ...extra,
  });
async function setup(manifest = base()) {
  const raw = await openSqliteStore(":memory:");
  stores.push(raw);
  const marks: string[] = [];
  const store = wrapStore(raw, (topic) => marks.push(topic));
  const put = (m: ReturnType<typeof base>, h = hash, at = "2026-11-12") =>
    store.putFlow({ id: m.id, version: "1", hash: h, manifest: m, files: {}, registeredAt: at });
  put(manifest);
  marks.length = 0;
  const capabilities = createCapabilities({ store, now, facts: () => ({ hooks: true, chrome: true }) });
  return { store, marks, put, capabilities };
}

test("rows come in manifest order: a routed web row, a routed path row, two dropped rows with their reasons, and no row for the harness requirement", async () => {
  const { capabilities } = await setup();
  const preview = capabilities.get("local.test");
  expect(preview.needsAllow).toBe(true);
  const rows = preview.rows;
  expect(rows.map((r) => [r.requirementId, r.routed])).toEqual([
    ["web", true],
    ["path", true],
    ["skill", false],
    ["cli", false],
  ]);
  expect(rows.slice(2).map((r) => r.reason)).toEqual([
    "FlowDriven cannot provide this yet.",
    "FlowDriven cannot provide this yet.",
  ]);
});
test("sentences, hosts and folders come from FlowDriven and pass visible: a folder with control and bidi characters is shown cleaned, and no step text, why or name reaches a row", async () => {
  const folder = `notes${String.fromCodePoint(10, 0x202e)}folder`;
  const { capabilities } = await setup(
    base([web(), { id: "path", type: "path", ref: folder, why: "Secret why" }]),
  );
  const rows = capabilities.get("local.test").rows;
  const value = JSON.stringify(rows);
  expect(value).not.toContain("Secret");
  expect(value).not.toContain(String.fromCodePoint(0x202e));
  expect(value).not.toContain("\\n");
  expect(rows.at(1)?.sentence).toBe("Reads files in notes<U+000A><U+202E>folder.");
});
test("the web row has the provider, `FlowDriven hook in Claude Code`, `unofficial`, the spec's sentence, `away: true`, the 12,000 token cost line and the template behind details; the path row has the 10,600 token line", async () => {
  const { capabilities } = await setup();
  const rows = capabilities.get("local.test").rows;
  expect(rows.at(0)).toMatchObject({
    provider: "Claude in Chrome inside Claude Code",
    enforcedBy: "FlowDriven hook in Claude Code",
    label: "unofficial",
    labelSentence: "This uses your personal browser. Every site you are logged into is reachable from it.",
    away: true,
    sentence: "Reads pages on www.upwork.com in your own browser, at most 3 per run and 10 a day.",
    cost: "Adds about 12,000 tokens to each call of a step that uses it.",
    details: ["https://www.upwork.com/jobs/{job:[a-z]{1,20}}"],
  });
  expect(rows.at(1)).toMatchObject({
    cost: "Adds about 10,600 tokens to each call of a step that uses it.",
    details: [],
  });
});
test("eight templates on eight hosts: the sentence lists every host and the details list every template, nothing is cut", async () => {
  const patterns = Array.from({ length: 8 }, (_, i) => `https://host${i}.example.com/`);
  const { capabilities } = await setup(base([web(patterns)]));
  const row = capabilities.get("local.test").rows.at(0);
  expect(row?.details).toEqual(patterns);
  expect(row?.sentence).toBe(
    `Reads pages on ${patterns.map((p) => new URL(p).host).join(", ")} in your own browser, at most 3 per run and 10 a day.`,
  );
});
test("a flow with nine templates, an unparsable template or 51 rows is refused with `This flow declares more than the preview can show.` by get and by allow", async () => {
  for (const requirements of [
    [web(Array.from({ length: 9 }, (_, i) => `https://h${i}.example.com/`))],
    [web(["not a template"])],
    Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, type: "skill" })),
  ]) {
    const { capabilities } = await setup(base(requirements));
    for (const action of [() => capabilities.get("local.test"), () => capabilities.allow("local.test", hash)])
      expect(action).toThrow(
        expect.objectContaining({
          code: "not_allowed",
          message: "This flow declares more than the preview can show.",
        }),
      );
  }
});
test("caps: 24 and 20 by default for a flow with a schedule trigger, 24 and none for a manual flow, and the flow's own numbers when it has limits", async () => {
  const scheduled = [{ kind: "schedule", every: "1h" }];
  for (const [extra, caps] of [
    [{ triggers: scheduled }, { maxRunsPerDay: 24, maxItems: 20 }],
    [{ triggers: [{ kind: "manual" }] }, { maxRunsPerDay: 24 }],
    [
      { triggers: scheduled, limits: { max_runs_per_day: 7, max_items: 4 } },
      { maxRunsPerDay: 7, maxItems: 4 },
    ],
  ] as const) {
    const { capabilities } = await setup(base(undefined, extra));
    const result = capabilities.get("local.test");
    expect(result.caps).toEqual(caps);
    expect(result.hasTriggers).toBe(extra.triggers[0]?.kind !== "manual");
  }
});
test("consent: none, given after allow, stale after the flow gets a new hash, none after withdraw", async () => {
  const { capabilities, put } = await setup();
  expect(capabilities.consentOf("local.test")).toBe("none");
  expect(capabilities.allow("local.test", hash).consent).toBe("given");
  put(base(), hash2, "2026-11-13");
  expect(capabilities.get("local.test").consent).toBe("stale");
  expect(capabilities.withdraw("local.test").consent).toBe("none");
});
test("allow is refused for a hash that is not the newest with `not_allowed`, and an unknown flow is `not_found`", async () => {
  const { capabilities } = await setup();
  expect(() => capabilities.allow("local.test", hash2)).toThrow(
    expect.objectContaining({
      code: "not_allowed",
      message: "This flow changed since you looked at it. Reload and check it again.",
    }),
  );
  expect(() => capabilities.get("local.missing")).toThrow(
    expect.objectContaining({ code: "not_found", message: "There is no flow local.missing." }),
  );
});
test("allow and withdraw write the audit lines `capabilities_allowed` and `capabilities_withdrawn` and mark the flows topic", async () => {
  const { capabilities, store, marks } = await setup();
  capabilities.allow("local.test", hash);
  capabilities.withdraw("local.test");
  expect(store.listAudit().map(({ kind, detail }) => ({ kind, detail }))).toEqual([
    { kind: "capabilities_allowed", detail: { flowId: "local.test", hash } },
    { kind: "capabilities_withdrawn", detail: { flowId: "local.test" } },
  ]);
  expect(marks).toEqual(["flows", "readiness", "flows", "readiness"]);
});
test("through the dispatcher the three operations validate their input and the outputs parse against the contract", async () => {
  // The service of this test has no harness facts, so the web row is dropped; the step uses the skill
  // requirement so that the allow has nothing routed to refuse.
  const { store } = await setup(
    base(undefined, {
      steps: [{ id: "worker", do: "worker", instructions: "Secret instructions", uses: ["skill"] }],
    }),
  );
  const service = createRunnerService({ store, dataDir: "/tmp/flowdriven-capabilities", mode: "demo", now });
  for (const [name, input] of [
    ["flows.capabilities", { flowId: "local.test" }],
    ["flows.allowCapabilities", { flowId: "local.test", hash }],
    ["flows.withdrawCapabilities", { flowId: "local.test" }],
  ] as const) {
    expect(FlowCapabilities.safeParse(await service.call(name, input)).success).toBe(true);
    await expect(service.call(name, {})).rejects.toMatchObject({ code: "invalid_input" });
  }
  await expect(
    service.call("flows.allowCapabilities", { flowId: "local.test", hash: "bad" }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  service.stop();
});
test("allow is refused with the not-routed sentence while a used web row is dropped, and accepted once it is routed", async () => {
  const { store } = await setup();
  const facts = { hooks: true, chrome: false };
  const capabilities = createCapabilities({ store, now, facts: () => ({ ...facts }) });
  expect(ALLOW_NOT_ROUTED).toBe(
    "FlowDriven cannot provide the web pages this flow reads yet, so there is nothing to allow.",
  );
  expect(capabilities.get("local.test").rows.at(0)?.routed).toBe(false);
  expect(() => capabilities.allow("local.test", hash)).toThrow(
    expect.objectContaining({ code: "not_allowed", message: ALLOW_NOT_ROUTED }),
  );
  expect(capabilities.consentOf("local.test")).toBe("none");
  expect(store.listAudit()).toEqual([]);
  facts.hooks = false;
  facts.chrome = true;
  expect(() => capabilities.allow("local.test", hash)).toThrow(
    expect.objectContaining({ code: "not_allowed", message: ALLOW_NOT_ROUTED }),
  );
  facts.hooks = true;
  expect(capabilities.allow("local.test", hash).consent).toBe("given");
  expect(store.listAudit().map((entry) => entry.kind)).toEqual(["capabilities_allowed"]);
});
test("allow keeps its other checks first: a wrong hash is refused with the changed sentence even while the web row is dropped", async () => {
  const { store } = await setup();
  const capabilities = createCapabilities({ store, now, facts: () => ({ hooks: true, chrome: false }) });
  expect(() => capabilities.allow("local.test", hash2)).toThrow(
    expect.objectContaining({
      message: "This flow changed since you looked at it. Reload and check it again.",
    }),
  );
});
test("a web requirement that no step uses does not stop the allow", async () => {
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Secret name",
    kind: "light",
    steps: [{ id: "worker", do: "worker", instructions: "Secret instructions", uses: ["path"] }],
    requirements: [web(), { id: "path", type: "path", ref: "notes" }, { id: "harness", type: "harness" }],
  });
  const { store } = await setup(manifest);
  const capabilities = createCapabilities({ store, now, facts: () => ({ hooks: true, chrome: false }) });
  expect(capabilities.get("local.test").rows.at(0)?.routed).toBe(false);
  expect(capabilities.allow("local.test", hash).consent).toBe("given");
});
test("a used web requirement inside a loop is checked too", async () => {
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Secret name",
    kind: "light",
    steps: [
      {
        id: "each",
        for_each: "items",
        as: "item",
        steps: [{ id: "page", do: "worker", instructions: "Secret instructions", uses: ["web"] }],
      },
    ],
    requirements: [web(), { id: "harness", type: "harness" }],
  });
  const { store } = await setup(manifest);
  const capabilities = createCapabilities({ store, now, facts: () => ({ hooks: true, chrome: false }) });
  expect(() => capabilities.allow("local.test", hash)).toThrow(
    expect.objectContaining({ message: ALLOW_NOT_ROUTED }),
  );
});
test("the details of a web row show each template as the flow wrote it", async () => {
  const patterns = [
    "https://www.upwork.com/jobs/~{id:[0-9a-z]{18,24}}",
    "https://example.com/a/{slug:[a-z-]{1,40}}/p/{n:[0-9]{1,3}}",
  ];
  const { capabilities } = await setup(base([web(patterns)]));
  expect(capabilities.get("local.test").rows.at(0)?.details).toEqual(patterns);
});
test("get carries allowBlocked while a used web row is dropped and leaves it out once the row is routed", async () => {
  const { store } = await setup();
  const facts = { hooks: true, chrome: false };
  const capabilities = createCapabilities({ store, now, facts: () => ({ ...facts }) });
  const blocked = capabilities.get("local.test");
  expect(blocked.rows.at(0)?.routed).toBe(false);
  expect(blocked.allowBlocked).toBe(ALLOW_NOT_ROUTED);
  facts.hooks = false;
  facts.chrome = true;
  expect(capabilities.get("local.test").allowBlocked).toBe(ALLOW_NOT_ROUTED);
  facts.hooks = true;
  const open = capabilities.get("local.test");
  expect(open.rows.at(0)?.routed).toBe(true);
  expect("allowBlocked" in open).toBe(false);
  expect(() => capabilities.allow("local.test", hash)).not.toThrow();
  expect("allowBlocked" in capabilities.get("local.test")).toBe(false);
});
test("an unused web requirement that is not routed leaves allowBlocked out, and the allow is accepted", async () => {
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Secret name",
    kind: "light",
    steps: [{ id: "worker", do: "worker", instructions: "Secret instructions", uses: ["path"] }],
    requirements: [web(), { id: "path", type: "path", ref: "notes" }, { id: "harness", type: "harness" }],
  });
  const { store } = await setup(manifest);
  const capabilities = createCapabilities({ store, now, facts: () => ({ hooks: true, chrome: false }) });
  const preview = capabilities.get("local.test");
  expect(preview.rows.at(0)?.routed).toBe(false);
  expect("allowBlocked" in preview).toBe(false);
  expect(capabilities.allow("local.test", hash).consent).toBe("given");
});
