import { createHash } from "node:crypto";
import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import type { Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
async function ready(text: string, ownText = true) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    steps: [
      {
        id: "plan",
        title: "Build plan",
        do: "worker",
        instructions: "Work",
        retry: 1,
        outputs: [{ id: "plan", type: "text" }],
        checks: [{ type: "user", ...(ownText ? { own_text: true } : {}) }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const c = await setup(parsed.manifest, {
    steps: { plan: { text: "Worker report", outputs: { plan: text } } },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(parsed.manifest.id, { project: "/tmp" });
  return { ...c, run };
}
function approval(c: Awaited<ReturnType<typeof ready>>) {
  const a = c.engine.listApprovals().at(0);
  if (!a) throw new Error("missing approval");
  return a;
}
const hash = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

test("an own_text sign-off shows the output text itself and says a later step may run commands from it", async () => {
  const c = await ready("The plan");
  expect(approval(c)).toMatchObject({
    payload: "The plan",
    summary: 'Approve "Build plan" as your own words. A later step may run commands on your Mac from it.',
    ownText: { output: "plan", hash: hash("The plan") },
  });
});
test("approving it stores the hash of that text on the step row and writes own_text_approved, with no text in the audit", async () => {
  const c = await ready("The plan");
  const a = approval(c);
  await c.engine.decide(a.id, "approve");
  expect(c.store.getStep(c.run.id, "plan")?.ownerApproved).toEqual({
    output: "plan",
    hash: hash("The plan"),
    approvalId: a.id,
    at: c.store.getApproval(a.id)?.resolvedAt,
  });
  const audit = c.store.listAudit(c.run.id).find((entry) => entry.kind === "own_text_approved");
  expect(audit?.detail).toEqual({ stepId: "plan", itemKey: "", hash: hash("The plan") });
  expect(JSON.stringify(audit)).not.toContain("The plan");
});
test("a text over 4,000 characters, or with a hidden character, fails the check and makes no sign-off", async () => {
  for (const [text, reason] of [
    ["x".repeat(4001), "The text to approve is longer than 4,000 characters."],
    [`a${String.fromCodePoint(0x200b)}b`, "The text to approve has hidden characters."],
  ] as const) {
    const c = await ready(text);
    expect(c.run.state).toBe("blocked");
    expect(c.engine.listApprovals()).toEqual([]);
    expect(c.harness.calls.at(1)?.lastFailure).toBe(reason);
  }
});
test("a sign-off without own_text keeps the report text and stores no mark", async () => {
  const c = await ready("The plan", false);
  const a = approval(c);
  expect(a.payload).toBe("Worker report");
  await c.engine.decide(a.id, "approve");
  expect(c.store.getStep(c.run.id, "plan")?.ownerApproved).toBeUndefined();
});
test("when the output changed between the card and the approval, no mark is stored and own_text_changed is written", async () => {
  const c = await ready("The plan");
  const row = c.store.getStep(c.run.id, "plan");
  if (!row) throw new Error("missing step");
  row.outputs.plan = "Changed";
  c.store.upsertStep(row);
  await c.engine.decide(approval(c).id, "approve");
  expect(c.store.getStep(c.run.id, "plan")?.ownerApproved).toBeUndefined();
  expect(c.store.listAudit(c.run.id).find((entry) => entry.kind === "own_text_changed")?.detail).toEqual({
    stepId: "plan",
    itemKey: "",
  });
});
