import { FlowCapabilities, type FlowManifest, ReadinessReport, RunDetail } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { createFixtureRunnerClient } from "./client";
import { buildLooped } from "./state";
import { capabilitiesOf } from "./story/capabilities";

const FLOW = "dev.example.job-review";
const UNOFFICIAL = "This uses your personal browser. Every site you are logged into is reachable from it.";

function looped() {
  return createFixtureRunnerClient({ scenario: "looped" });
}
function record(client: ReturnType<typeof looped>) {
  const found = client.state.flows.find((f) => f.manifest.id === FLOW);
  if (!found) throw new Error("The job-alert flow is missing.");
  return found;
}

test("the job-alert flow has a routed web row, a routed path row and two dropped rows, in that order, and every row parses against the contract", async () => {
  const client = looped();
  const caps = FlowCapabilities.parse(await client.call("flows.capabilities", { flowId: FLOW }));
  expect(caps.rows.map((row) => [row.requirementId, row.type, row.routed])).toEqual([
    ["jobs_web", "web", true],
    ["data", "path", true],
    ["gmail", "mcp_server", false],
    ["builder", "skill", false],
  ]);
  const [web, path, gmail, builder] = caps.rows;
  expect(web).toEqual({
    requirementId: "jobs_web",
    type: "web",
    sentence: "Reads pages on www.upwork.com in your own browser, at most 3 per run and 10 a day.",
    routed: true,
    provider: "Claude in Chrome inside Claude Code",
    enforcedBy: "FlowDriven hook in Claude Code",
    label: "unofficial",
    labelSentence: UNOFFICIAL,
    away: true,
    cost: "Adds about 12,000 tokens to each call of a step that uses it.",
    details: ["https://www.upwork.com/jobs/~{id}"],
  });
  expect(path?.sentence).toBe("Reads and writes files in job-review.");
  expect(path?.cost).toBe("Adds about 10,600 tokens to each call of a step that uses it.");
  expect(path?.enforcedBy).toBe("FlowDriven hook in Claude Code");
  expect(path?.label).toBe("official");
  expect(gmail).toMatchObject({
    sentence: "A connector: connector:gmail.",
    reason: "FlowDriven cannot provide this yet.",
    away: false,
    details: [],
  });
  expect(builder).toMatchObject({
    sentence: "A skill: claude-code:prototype-builder.",
    reason: "FlowDriven cannot provide this yet.",
    away: false,
    details: [],
  });
  expect(caps).toMatchObject({
    flowId: FLOW,
    caps: { maxRunsPerDay: 24, maxItems: 20 },
    hasTriggers: true,
    needsAllow: true,
    consent: "none",
  });
});

test("consent starts as none; allow with the flow's hash gives given and the Allow state; a wrong hash is not_allowed; withdraw gives none again", async () => {
  const client = looped();
  const hash = record(client).hash;
  expect((await client.call("flows.capabilities", { flowId: FLOW })).consent).toBe("none");
  await expect(
    client.call("flows.allowCapabilities", { flowId: FLOW, hash: `sha256:${"f".repeat(64)}` }),
  ).rejects.toMatchObject({ code: "not_allowed" });
  expect(client.state.capabilityConsents[FLOW]).toBeUndefined();
  const given = await client.call("flows.allowCapabilities", { flowId: FLOW, hash });
  expect(given.consent).toBe("given");
  expect(client.state.capabilityConsents[FLOW]).toEqual({ hash });
  expect((await client.call("flows.capabilities", { flowId: FLOW })).consent).toBe("given");
  const withdrawn = await client.call("flows.withdrawCapabilities", { flowId: FLOW });
  expect(withdrawn.consent).toBe("none");
  expect(client.state.capabilityConsents[FLOW]).toBeUndefined();
});

test("a changed flow hash makes a given consent stale", async () => {
  const client = looped();
  const found = record(client);
  await client.call("flows.allowCapabilities", { flowId: FLOW, hash: found.hash });
  found.hash = `sha256:${"a".repeat(64)}`;
  expect((await client.call("flows.capabilities", { flowId: FLOW })).consent).toBe("stale");
  expect(capabilitiesOf(found, { hash: found.hash }).consent).toBe("given");
});

test("a flow with only a path and a harness requirement has needsAllow false", () => {
  const found = structuredClone(record(looped()));
  const keep = new Set(["worker", "data"]);
  found.manifest.requirements = found.manifest.requirements.filter((req) => keep.has(req.id));
  for (const step of found.manifest.steps) {
    for (const leaf of "loop" in step && step.loop ? step.loop.steps : [step])
      leaf.uses = leaf.uses.filter((id) => keep.has(id));
  }
  const caps = capabilitiesOf(found, undefined);
  expect(caps.needsAllow).toBe(false);
  expect(caps.rows.map((row) => row.requirementId)).toEqual(["data"]);
  expect(caps.consent).toBe("none");
});

test("the capabilities of an unknown flow are not_found", async () => {
  const client = looped();
  for (const name of ["flows.capabilities", "flows.withdrawCapabilities"] as const)
    await expect(client.call(name, { flowId: "nope" })).rejects.toMatchObject({ code: "not_found" });
  await expect(
    client.call("flows.allowCapabilities", { flowId: "nope", hash: `sha256:${"0".repeat(64)}` }),
  ).rejects.toMatchObject({ code: "not_found" });
});

test("run-0008 validates with the outside mark, one page read and one blocked call, and the looped scenario still has 6 flows, 8 runs and 6 pending approvals", () => {
  const state = buildLooped();
  expect(state.flows).toHaveLength(6);
  expect(state.runs).toHaveLength(8);
  expect(state.approvals.filter((approval) => approval.state === "pending")).toHaveLength(6);
  expect(state.capabilityConsents).toEqual({});
  const run = RunDetail.parse(state.runs.find((item) => item.id === "run-0008"));
  const item = run.steps.find((step) => step.stepId === "review")?.items?.find((it) => it.key === "j1");
  const page = item?.steps.find((step) => step.stepId === "page");
  expect(page).toMatchObject({
    outside: true,
    pagesRead: 1,
    blocked: [
      { tool: "mcp__claude-in-chrome__computer", reason: "This step may only read pages.", count: 1 },
    ],
  });
  const manifest: FlowManifest | undefined = state.flows.find((f) => f.manifest.id === FLOW)?.manifest;
  const review = manifest?.steps.find((step) => step.id === "review");
  expect(review && "loop" in review ? review.loop?.steps.find((s) => s.id === "page")?.uses : []).toEqual([
    "worker",
    "jobs_web",
  ]);
  expect(manifest?.steps.find((step) => step.id === "build")).toBeDefined();
});

test("the readiness report of the job-alert flow has an ok Chrome row with an unofficial route", async () => {
  const client = looped();
  const report = ReadinessReport.parse(await client.call("readiness.check", { flowId: FLOW }));
  expect(report.items.map((entry) => entry.requirementId)).toEqual([
    "worker",
    "jobs_web",
    "data",
    "gmail",
    "builder",
  ]);
  const chrome = report.items.find((entry) => entry.requirementId === "jobs_web");
  expect(chrome).toMatchObject({
    state: "ok",
    route: { via: "Claude in Chrome inside Claude Code", risk: "unofficial", note: UNOFFICIAL },
  });
  expect(report.ready).toBe(true);
});
