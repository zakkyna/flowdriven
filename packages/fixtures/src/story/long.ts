import { approvalExpiresAt } from "@flowdriven/contracts";
import { FIXTURE_NOW, type FixtureState } from "../state";
import { makeFlow } from "./flows";
import { readiness } from "./readiness";
export function addLong(state: FixtureState): void {
  const flow = makeFlow(
    "quarterly-compliance-review",
    "Quarterly supplier compliance and contract renewal review for every regional warehouse in the northern distribution network",
    "light",
    "1.0.0",
    [["review", "Review every warehouse contract", ["user"], ["You approve the review"]]],
    [["worker", "harness", "codex"]],
    6,
  );
  const req = flow.manifest.requirements[0];
  if (req) req.why = "Does the review.";
  state.flows.push(flow);
  state.nextHashNumber = 7;
  Object.assign(state.readiness, readiness([flow]));
  const createdAt = "2026-11-10T09:25:00.000Z";
  state.approvals.unshift({
    id: "ap-0016",
    kind: "risky_action",
    riskyAction: "send",
    flowId: flow.manifest.id,
    flowName: flow.manifest.name,
    summary: "Send the renewal notice to 16 warehouse managers",
    payload: {
      kind: "email",
      to: Array.from({ length: 16 }, (_, i) => `manager-${String(i + 1).padStart(2, "0")}@example.com`),
      subject: "Renewal notice for the northern distribution network",
      body: `Hello managers,\n\nPlease review the renewal notice for your warehouse. The contract details follow ${String.fromCodePoint(0x202e)}and ${String.fromCodePoint(0x200b)} require your attention.\n${"x".repeat(4000)}`,
    },
    editable: true,
    createdAt,
    expiresAt: approvalExpiresAt(createdAt),
    state: "pending",
  });
  const report = state.readiness[flow.manifest.id];
  if (report) report.checkedAt = FIXTURE_NOW;
}
