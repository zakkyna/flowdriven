import { isRunnerError } from "@flowdriven/contracts";
import { describe, expect, test, vi } from "vitest";
import { createFixtureRunnerClient, PREVIEW_AGENT_REPLY } from "./index";

const FIGMA = "dev.example.figma-to-flutter";
const fails = async (p: Promise<unknown>, code: string, message?: string) => {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(isRunnerError(e) && e.code).toBe(code);
  if (message) expect((e as Error).message).toBe(message);
};

describe("FixtureRunnerClient", () => {
  test("lists flows and validates input", async () => {
    const c = createFixtureRunnerClient();
    expect((await c.call("flows.list", {})).map((f) => f.id)[1]).toBe(FIGMA);
    await fails(c.call("runs.status", {} as never), "invalid_input");
    await fails(c.call("runs.status", { runId: "run-9999" }), "not_found", "There is no run run-9999.");
    await fails(c.call("flows.get", { flowId: "nope" }), "not_found", "There is no flow nope.");
    expect((await c.call("runs.list", { project: "~/Reports/q3-suppliers" })).map((r) => r.id)).toEqual([
      "run-0005",
      "run-0001",
    ]);
  });
  test("approving the last waiting item resumes the run and notifies", async () => {
    const c = createFixtureRunnerClient();
    const listener = vi.fn();
    c.subscribe(listener);
    const [resolved] = await c.call("approvals.resolve", { approvalId: "ap-0014", decision: "approve" });
    expect(resolved?.state).toBe("approved");
    expect((await c.call("runs.status", { runId: "run-0004" })).state).toBe("running");
    expect(listener).toHaveBeenCalledWith({ type: "changed", topics: ["approvals", "runs", "flows"] });
  });
  test("approve all similar resolves the three sends together", async () => {
    const c = createFixtureRunnerClient();
    const done = await c.call("approvals.resolve", {
      approvalId: "ap-0011",
      decision: "approve",
      applyToSimilar: true,
    });
    expect(done.map((a) => a.id).sort()).toEqual(["ap-0011", "ap-0012", "ap-0013"]);
    expect((await c.call("runs.status", { runId: "run-0007" })).state).toBe("running");
  });
  test("reject fails the run; a decision is made once", async () => {
    const c = createFixtureRunnerClient();
    await c.call("approvals.resolve", { approvalId: "ap-0014", decision: "reject" });
    expect((await c.call("runs.status", { runId: "run-0004" })).state).toBe("failed");
    await fails(
      c.call("approvals.resolve", { approvalId: "ap-0014", decision: "approve" }),
      "not_allowed",
      "This decision was already made.",
    );
  });
  test("edit writes the new text; diffs cannot be edited", async () => {
    const c = createFixtureRunnerClient();
    const [a] = await c.call("approvals.resolve", {
      approvalId: "ap-0012",
      decision: "edit",
      editedText: "Hi Tomás, it ships Friday.",
    });
    expect(a?.payload).toMatchObject({ kind: "email", body: "Hi Tomás, it ships Friday." });
    await fails(
      c.call("approvals.resolve", { approvalId: "ap-0015", decision: "edit", editedText: "x" }),
      "invalid_input",
      "Only text can be edited.",
    );
  });
  test("step edits bump the version, go stale and undo", async () => {
    const c = createFixtureRunnerClient();
    await fails(
      c.call("flows.update", {
        flowId: FIGMA,
        edit: { kind: "move", stepId: "read-design", direction: "up" },
      }),
      "not_allowed",
      "The first step can't move up.",
    );
    const moved = await c.call("flows.update", {
      flowId: FIGMA,
      edit: { kind: "move", stepId: "plan-widgets", direction: "up" },
    });
    expect(moved.manifest.steps.map((s) => s.id).slice(0, 2)).toEqual(["plan-widgets", "read-design"]);
    expect(moved.manifest.version).toBe("1.0.1");
    expect(moved.signOff).toEqual({ state: "stale", version: "1.0.0" });
    const undone = await c.call("flows.update", { flowId: FIGMA, edit: { kind: "undo" } });
    expect(undone.manifest.version).toBe("1.0.0");
    expect(undone.signOff.state).toBe("approved");
    expect(undone.canUndo).toBe(false);
  });
  test("deleted step ids are never reused", async () => {
    const c = createFixtureRunnerClient();
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "duplicate", stepId: "open-pr" } });
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "delete", stepId: "open-pr-2" } });
    const again = await c.call("flows.update", {
      flowId: FIGMA,
      edit: { kind: "duplicate", stepId: "open-pr" },
    });
    expect(again.manifest.steps.map((s) => s.id)).toContain("open-pr-3");
  });
  test("running a flow that is not ready opens a blocked run", async () => {
    const c = createFixtureRunnerClient();
    expect(await c.call("flows.run", { flowId: FIGMA })).toMatchObject({ id: "run-0008", state: "blocked" });
    expect(await c.call("flows.run", { flowId: "dev.example.documents-and-reports" })).toMatchObject({
      id: "run-0009",
      state: "queued",
    });
  });
  test("a flow whose sign-off is not approved cannot run", async () => {
    const c = createFixtureRunnerClient();
    await fails(
      c.call("flows.run", { flowId: "dev.example.lead-follow-up" }),
      "not_allowed",
      "This version needs your approval before it runs.",
    );
    await c.call("approvals.resolve", { approvalId: "ap-0015", decision: "approve" });
    expect(await c.call("flows.run", { flowId: "dev.example.lead-follow-up" })).toMatchObject({
      id: "run-0008",
      state: "queued",
    });
  });
  test("install for me marks the item ok, only for catalog items", async () => {
    const c = createFixtureRunnerClient();
    const report = await c.call("readiness.install", {
      flowId: "dev.example.social-posts",
      requirementId: "ffmpeg",
    });
    expect(report.items.find((i) => i.requirementId === "ffmpeg")).toMatchObject({
      state: "ok",
      detail: "Sample data: nothing was installed.",
    });
    await fails(
      c.call("readiness.install", { flowId: "dev.example.social-posts", requirementId: "wordpress" }),
      "not_allowed",
    );
  });
  test("consent and settings follow their rules", async () => {
    const c = createFixtureRunnerClient();
    await fails(
      c.call("settings.update", { patch: { brain: { main: "agy-cli" } } }),
      "not_allowed",
      "Antigravity CLI can't be the brain yet.",
    );
    expect(
      (await c.call("harnesses.setConsent", { harnessId: "antigravity", consent: "given" })).consent,
    ).toBe("given");
    expect((await c.call("settings.get", {})).backends.find((b) => b.id === "agy-cli")?.consent).toBe(
      "given",
    );
    expect((await c.call("settings.update", { patch: { brain: { main: "agy-cli" } } })).brain.main).toBe(
      "agy-cli",
    );
    await fails(c.call("harnesses.setConsent", { harnessId: "codex", consent: "given" }), "not_allowed");
    expect((await c.call("settings.update", { patch: { budget: { capUsd: 30 } } })).budget.capUsd).toBe(30);
    await fails(
      c.call("settings.update", { patch: { brain: { subscriptionOrder: ["nope"] } } }),
      "invalid_input",
      "Unknown brain nope.",
    );
  });
  test("chat appends the preview reply; the empty and long scenarios load", async () => {
    const c = createFixtureRunnerClient();
    const { reply } = await c.call("flows.build", { flowId: FIGMA, message: "Add a Slack step" });
    expect(reply.text).toBe(PREVIEW_AGENT_REPLY);
    expect((await c.call("flows.get", { flowId: FIGMA })).conversation.at(-2)?.text).toBe("Add a Slack step");
    expect(await createFixtureRunnerClient({ scenario: "empty" }).call("approvals.list", {})).toEqual([]);
    expect(await createFixtureRunnerClient({ scenario: "long" }).call("flows.list", {})).toHaveLength(6);
  });
});
