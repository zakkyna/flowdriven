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
  test("blocked run reason uses singular and plural", async () => {
    const c = createFixtureRunnerClient();
    const single = await c.call("flows.run", { flowId: FIGMA });
    const plural = await c.call("flows.run", { flowId: "dev.example.social-posts" });
    expect((await c.call("runs.status", { runId: single.id })).blockedReason).toBe(
      "Not ready: 1 required item needs attention.",
    );
    expect((await c.call("runs.status", { runId: plural.id })).blockedReason).toBe(
      "Not ready: 4 required items need attention.",
    );
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
  test("stale edits create one review, undo clears it, and approval permits a run", async () => {
    const c = createFixtureRunnerClient();
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "add", title: "Review" } });
    let pending = (await c.call("approvals.list", { state: "pending" })).filter((a) => a.flowId === FIGMA);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload.kind).toBe("diff");
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "undo" } });
    expect(
      (await c.call("approvals.list", { state: "pending" })).filter((a) => a.flowId === FIGMA),
    ).toHaveLength(0);
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "add", title: "Review" } });
    pending = (await c.call("approvals.list", { state: "pending" })).filter((a) => a.flowId === FIGMA);
    await c.call("approvals.resolve", { approvalId: pending[0]?.id ?? "", decision: "approve" });
    expect((await c.call("flows.run", { flowId: FIGMA })).flowId).toBe(FIGMA);
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "undo" } });
    expect(
      (await c.call("approvals.list", { state: "pending" })).filter((a) => a.flowId === FIGMA),
    ).toHaveLength(1);
  });
  test("approval expiration occurs at 24 hours and fails its step", async () => {
    let time = new Date("2026-11-10T16:19:00.000Z");
    const c = createFixtureRunnerClient({ now: () => time });
    expect((await c.call("approvals.list", { state: "pending" })).some((a) => a.id === "ap-0014")).toBe(true);
    time = new Date("2026-11-10T16:20:00.000Z");
    expect(
      (await c.call("approvals.list", { state: "expired" })).find((a) => a.id === "ap-0014")?.resolvedAt,
    ).toBe(time.toISOString());
    const run = await c.call("runs.status", { runId: "run-0004" });
    expect(run.state).toBe("failed");
    expect(run.steps.find((s) => s.state === "failed")?.note).toBe("The approval expired after 24 hours.");
    await fails(
      c.call("approvals.resolve", { approvalId: "ap-0014", decision: "approve" }),
      "not_allowed",
      "This approval expired.",
    );
  });
  test("approving remaining decisions cannot restart a failed run", async () => {
    const c = createFixtureRunnerClient();
    await c.call("approvals.resolve", { approvalId: "ap-0013", decision: "reject" });
    await c.call("approvals.resolve", { approvalId: "ap-0011", decision: "approve", applyToSimilar: true });
    expect((await c.call("runs.status", { runId: "run-0007" })).state).toBe("failed");
  });
  test("equal timestamps put newer runs and approvals first", async () => {
    const c = createFixtureRunnerClient();
    await c.call("flows.run", { flowId: FIGMA });
    await c.call("flows.run", { flowId: FIGMA });
    expect((await c.call("runs.list", { flowId: FIGMA }))[0]?.id).toBe("run-0009");
    expect((await c.call("flows.list", {})).find((f) => f.id === FIGMA)?.lastRun?.runId).toBe("run-0009");
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "add", title: "One" } });
    await c.call("flows.update", {
      flowId: "dev.example.documents-and-reports",
      edit: { kind: "add", title: "Two" },
    });
    const list = await c.call("approvals.list", { state: "pending" });
    expect(list[0]?.flowId).toBe("dev.example.documents-and-reports");
  });
  test("edits must be nonblank and cannot apply to similar approvals", async () => {
    const c = createFixtureRunnerClient();
    await fails(
      c.call("approvals.resolve", {
        approvalId: "ap-0011",
        decision: "edit",
        editedText: "hello",
        applyToSimilar: true,
      }),
      "not_allowed",
    );
    await fails(
      c.call("approvals.resolve", { approvalId: "ap-0011", decision: "edit", editedText: "   " }),
      "invalid_input",
    );
  });
  test("settings ignore undefined and reject duplicate orders atomically", async () => {
    const c = createFixtureRunnerClient();
    const before = await c.call("settings.get", {});
    expect(
      await c.call("settings.update", {
        patch: { brain: { main: undefined }, budget: { capUsd: undefined } },
      }),
    ).toEqual(before);
    await fails(
      c.call("settings.update", { patch: { brain: { subscriptionOrder: ["codex-cli", "codex-cli"] } } }),
      "invalid_input",
    );
    expect(await c.call("settings.get", {})).toEqual(before);
  });
  test("revocation moves the main brain to an allowed fallback or refuses", async () => {
    const c = createFixtureRunnerClient();
    await c.call("harnesses.setConsent", { harnessId: "antigravity", consent: "given" });
    await c.call("settings.update", { patch: { brain: { main: "agy-cli" } } });
    await c.call("harnesses.setConsent", { harnessId: "antigravity", consent: "revoked" });
    expect((await c.call("settings.get", {})).brain.main).toBe("codex-cli");
    await fails(c.call("harnesses.setConsent", { harnessId: "copilot", consent: "given" }), "not_allowed");
    await c.call("harnesses.setConsent", { harnessId: "antigravity", consent: "given" });
    await c.call("settings.update", {
      patch: { brain: { main: "agy-cli", subscriptionOrder: [], apiKeyOrder: [] } },
    });
    await fails(
      c.call("harnesses.setConsent", { harnessId: "antigravity", consent: "revoked" }),
      "not_allowed",
    );
    expect((await c.call("settings.get", {})).brain.main).toBe("agy-cli");
  });
  test("new runs use the flow project and blank step titles are rejected", async () => {
    const c = createFixtureRunnerClient();
    expect((await c.call("flows.run", { flowId: FIGMA })).project).toBeTruthy();
    const before = await c.call("flows.get", { flowId: FIGMA });
    await fails(
      c.call("flows.update", { flowId: FIGMA, edit: { kind: "add", title: "   " } }),
      "invalid_input",
    );
    expect(await c.call("flows.get", { flowId: FIGMA })).toEqual(before);
  });
  test("undo across multiple edits keeps the newest approval stale until reviewed", async () => {
    const c = createFixtureRunnerClient();
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "add", title: "One" } });
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "add", title: "Two" } });
    const approval = (await c.call("approvals.list", { state: "pending" })).find((a) => a.flowId === FIGMA);
    await c.call("approvals.resolve", { approvalId: approval?.id ?? "", decision: "approve" });
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "undo" } });
    const result = await c.call("flows.update", { flowId: FIGMA, edit: { kind: "undo" } });
    expect(result.signOff).toEqual({ state: "stale", version: "1.0.2" });
    expect(
      (await c.call("approvals.list", { state: "pending" })).filter((a) => a.flowId === FIGMA),
    ).toHaveLength(1);
  });
  test("refreshing a pending sign-off preserves its id", async () => {
    const c = createFixtureRunnerClient();
    await c.call("flows.update", { flowId: FIGMA, edit: { kind: "add", title: "One" } });
    await c.call("flows.update", {
      flowId: "dev.example.lead-follow-up",
      edit: { kind: "add", title: "Two" },
    });
    expect(
      (await c.call("approvals.list", { state: "pending" })).find(
        (a) => a.flowId === "dev.example.lead-follow-up",
      )?.id,
    ).toBe("ap-0015");
  });
});
