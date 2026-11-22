import type { Touch } from "@flowdriven/sdk";
import type { RuleRow, Store } from "../storage.ts";

type Place = { kind: string; value: string; label?: string };
type Call = { flowId: string; touchId: string; effect: string; place?: Place };
type Version = {
  hash?: string;
  startedAt?: string;
  touches: { id: string; effect: string; place?: Place }[];
};

function samePlace(a: Place | undefined, b: Place | undefined): boolean {
  return a !== undefined && b !== undefined && a.kind === b.kind && a.value === b.value;
}

export function matchRule(rules: RuleRow[], call: Call, runVersion: Version): RuleRow | undefined {
  if (
    !call.place ||
    !(call.effect === "change"
      ? ["account", "folder"].includes(call.place.kind)
      : call.effect === "local_write"
        ? call.place.kind === "folder"
        : call.effect === "run_command" && call.place.kind === "command")
  )
    return undefined;
  if (
    !runVersion.touches.some(
      (touch) =>
        touch.id === call.touchId && touch.effect === call.effect && samePlace(touch.place, call.place),
    )
  )
    return undefined;
  return rules.find(
    (rule) =>
      rule.state === "active" &&
      (runVersion.startedAt === undefined ||
        Date.parse(rule.createdAt) < Date.parse(runVersion.startedAt) ||
        (Date.parse(rule.createdAt) === Date.parse(runVersion.startedAt) &&
          rule.confirmationHash !== undefined &&
          rule.confirmationHash === runVersion.hash)) &&
      rule.flowId === call.flowId &&
      rule.touchId === call.touchId &&
      rule.effect === call.effect &&
      samePlace(rule.place, call.place),
  );
}

export function placeTouches(touches: Touch[], { origin }: { origin: "chat" | "market" }) {
  const lists: { onItsOwn: string[]; asksFirst: string[]; never: string[] } = {
    onItsOwn: [],
    asksFirst: [],
    never: [],
  };
  for (const touch of touches) {
    if (touch.rule === "not_allowed") lists.never.push(touch.id);
    else if (
      touch.effect === "read" ||
      (origin === "chat" &&
        (touch.effect === "local_write" ||
          touch.effect === "run_command" ||
          (touch.effect === "change" && touch.place !== undefined)))
    )
      lists.onItsOwn.push(touch.id);
    else lists.asksFirst.push(touch.id);
  }
  return lists;
}

export function recordRuleUse(
  store: Store,
  input: {
    ruleId: string;
    runId: string;
    stepId: string;
    itemKey: string;
    tool: string;
    title: string;
    at: string;
  },
): void {
  store.transaction(() => {
    const rule = store.listRules().find((row) => row.id === input.ruleId && row.state === "active");
    const run = store.getRun(input.runId);
    const step = store.getStep(input.runId, input.stepId, input.itemKey);
    if (!rule || !run || !step || rule.flowId !== run.flowId) throw new Error("Rule use cannot be recorded.");
    store.useRule(rule.id, input.at);
    store.upsertStep({
      ...step,
      ruleUses: [...(step.ruleUses ?? []), { ruleId: rule.id, tool: input.tool, at: input.at }],
    });
    store.updateRun(run.id, {
      decisionLines: [
        ...(run.decisionLines ?? []),
        { key: "report.doneByRule", params: { title: input.title } },
      ],
    });
    store.appendAudit({
      at: input.at,
      kind: "rule_used",
      runId: run.id,
      detail: {
        ruleId: rule.id,
        flowId: run.flowId,
        touchId: rule.touchId,
        effect: rule.effect,
        placeKind: rule.place.kind,
        runId: run.id,
        stepId: step.stepId,
      },
    });
  });
}
