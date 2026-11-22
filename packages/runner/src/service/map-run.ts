import {
  type BlockedCall,
  CheckResult,
  LeafStepRun,
  RunDetail,
  RunSummary,
  type SkipReason,
} from "@flowdriven/contracts";
import type { LeafStep, Value } from "@flowdriven/sdk";
import type { RunView } from "../engine.ts";
import { limits } from "../exec/limits.ts";
import { reportLines, sumUsage } from "../report.ts";
import type { AuditEntry, RunRow, StepRow } from "../storage.ts";
import { triggerWords } from "../triggers/rules.ts";
import { toApproval } from "./map-approval.ts";
import { coreVersion } from "./map-flow.ts";
export function blockedCalls(
  audit: AuditEntry[],
  stepId: string,
  itemKey: string,
): BlockedCall[] | undefined {
  const rows: BlockedCall[] = [];
  for (const entry of audit) {
    const detail = entry.detail;
    if (
      (entry.kind !== "tool_denied" && entry.kind !== "page_withheld") ||
      !detail ||
      typeof detail !== "object" ||
      Array.isArray(detail) ||
      detail.stepId !== stepId ||
      detail.itemKey !== itemKey ||
      typeof detail.tool !== "string"
    )
      continue;
    const reason = entry.kind === "tool_denied" ? detail.reason : detail.sentence;
    if (typeof reason !== "string") continue;
    const existing = rows.find((row) => row.tool === detail.tool && row.reason === reason);
    if (existing) existing.count++;
    else if (rows.length < 20) rows.push({ tool: detail.tool, reason, count: 1 });
  }
  return rows.length ? rows : undefined;
}
export function pagesRead(audit: AuditEntry[], stepId: string, itemKey: string): number {
  let count = 0;
  for (const entry of audit) {
    const detail = entry.detail;
    if (
      entry.kind === "page_read" &&
      detail &&
      typeof detail === "object" &&
      !Array.isArray(detail) &&
      detail.stepId === stepId &&
      detail.itemKey === itemKey
    )
      count++;
  }
  return count;
}
export function itemLabel(item: Value, key: string): string {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    if (typeof item.title === "string") return item.title;
    if (typeof item.label === "string") return item.label;
  }
  return key;
}
export function skipReason(note: string | undefined): SkipReason | undefined {
  switch (note) {
    case "skipped: seen in an earlier run":
      return "seen";
    case "skipped: duplicate key":
      return "duplicate";
    case "skipped: over the item cap":
      return "capped";
    case "skipped: stopped after an item failed":
      return "stopped";
    default:
      return undefined;
  }
}
export function currentStep(view: RunView): RunSummary["currentStep"] {
  const { manifest, steps } = view;
  const states = manifest.steps.map(
    (step) => steps.find((row) => row.stepId === step.id && row.itemKey === "")?.state ?? "pending",
  );
  let index = states.findIndex((state) =>
    ["running", "retrying", "waiting_approval", "interrupted"].includes(state),
  );
  if (index < 0) index = states.indexOf("pending");
  if (index < 0) index = manifest.steps.length - 1;
  const step = manifest.steps[index];
  return step ? { index: index + 1, count: manifest.steps.length, title: step.title ?? step.id } : undefined;
}
export function toRunSummary(
  run: RunRow,
  flowName: string,
  reportFirstLine?: string,
  waiting?: import("../keeper/types.ts").Waiting,
  trigger?: { kind: string; words: string },
  currentHash?: string,
  current?: RunSummary["currentStep"],
): RunSummary {
  return RunSummary.parse({
    id: run.id,
    flowId: run.flowId,
    flowName: run.flowName ?? flowName,
    flowHash: run.flowHash,
    source: run.start?.source ?? "flows",
    agent: run.agent?.agent ?? "claude-code",
    model: run.agent?.model,
    chatId: run.start?.chatId,
    cause: run.cause,
    versionChanged: currentHash !== undefined && currentHash !== run.flowHash,
    currentStep: current,
    flowVersion: coreVersion(run.flowVersion),
    oneTime: false,
    project: run.project,
    state: run.state,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    reportFirstLine,
    waiting,
    trigger,
  });
}
export function toRunDetail(
  view: RunView,
  harnessIdOf: (workerName: string) => string,
  flowNameOf: (id: string) => string | undefined = () => undefined,
  flowExists = true,
  currentHash?: string,
): RunDetail {
  const { run, manifest } = view;
  const lines = reportLines(view);
  function leaf(step: LeafStep, row: StepRow | undefined): LeafStepRun {
    const attempt = row?.attempts.at(-1);
    let picks: { key: string; label: string }[] | undefined;
    if (step.do === "ask") {
      const approval = view.approvals.find((a) => a.stepId === step.id && a.itemKey === (row?.itemKey ?? ""));
      if (approval?.picks !== undefined) {
        const mapped = toApproval(approval, run, manifest);
        if (mapped.payload.kind !== "choice") throw new Error("Invalid choice approval");
        picks = approval.picks.map((key) => {
          const option =
            mapped.payload.kind === "choice" ? mapped.payload.options.find((o) => o.key === key) : undefined;
          if (!option) throw new Error("Choice option missing");
          return option;
        });
      } else if (
        row?.state === "passed" &&
        Array.isArray(row.outputs.choice) &&
        row.outputs.choice.length === 0
      )
        picks = [];
    }
    const blocked = blockedCalls(view.audit, step.id, row?.itemKey ?? "");
    const pages = pagesRead(view.audit, step.id, row?.itemKey ?? "");
    return LeafStepRun.parse({
      stepId: step.id,
      title: step.title ?? step.id,
      do: step.do,
      state: row?.state ?? "pending",
      worker: attempt && { harnessId: harnessIdOf(attempt.worker), name: attempt.worker },
      attempts: row?.attempts ?? [],
      maxAttempts: limits(step, manifest).attempts,
      checks: (row?.checks ?? []).map((c) => CheckResult.parse(c)),
      ...(blocked === undefined ? {} : { blocked }),
      ...(row?.outside === true ? { outside: true } : {}),
      ...(pages > 0 ? { pagesRead: pages } : {}),
      ...(row?.limitMs === undefined ? {} : { limitMs: row.limitMs }),
      note: row?.note,
      picks,
      usage: sumUsage(
        (view.usage ?? []).filter((u) => u.stepId === step.id && u.itemKey === (row?.itemKey ?? "")),
      ),
      waiting: view.waiting?.steps.find((w) => w.stepId === step.id && w.itemKey === (row?.itemKey ?? ""))
        ?.waiting,
    });
  }
  const steps = manifest.steps.map((step) => {
    const row = view.steps.find((r) => r.stepId === step.id && r.itemKey === "");
    if ("do" in step) return leaf(step, row);
    return {
      stepId: step.id,
      title: step.title ?? step.id,
      do: "loop",
      state: row?.state ?? "pending",
      attempts: row?.attempts ?? [],
      maxAttempts: 1,
      checks: (row?.checks ?? []).map((c) => CheckResult.parse(c)),
      note: row?.note,
      worker: row?.attempts.at(-1) && {
        harnessId: harnessIdOf(row.attempts.at(-1)?.worker ?? ""),
        name: row.attempts.at(-1)?.worker,
      },
      items: view.items
        .filter((i) => i.loopId === step.id)
        .toSorted((a, b) => a.position - b.position)
        .map((item) => ({
          key: item.key,
          label: itemLabel(item.item, item.key),
          state: item.status,
          skip: skipReason(item.note),
          note: item.note,
          steps:
            item.note === "skipped: duplicate key"
              ? []
              : step.steps.flatMap((s) => {
                  const found = view.steps.find((r) => r.stepId === s.id && r.itemKey === item.key);
                  return found ? [leaf(s, found)] : [];
                }),
        })),
    };
  });
  const inputs = [...Object.entries(run.inputs), ...Object.entries(run.params)].map(([id, value]) => ({
    id,
    label: manifest.inputs.find((i) => i.id === id)?.label ?? manifest.params[id]?.label ?? id,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
  const outputs = manifest.steps.flatMap((s) => {
    if (!("do" in s)) return [];
    const row = view.steps.find((r) => r.stepId === s.id && r.itemKey === "");
    return s.outputs.flatMap((o) => {
      const value = row?.outputs[o.id];
      if (value === undefined) return [];
      const text = JSON.stringify(value);
      return [
        { id: `${s.id}.${o.id}`, type: o.type, value: text.length > 200 ? `${text.slice(0, 200)}...` : text },
      ];
    });
  });
  const usageRows = view.usage ?? [];
  const harnesses = [...new Set(usageRows.map((u) => u.harness))].map((harnessId) => {
    const rows = usageRows.filter((u) => u.harness === harnessId);
    const total = sumUsage(rows);
    const costs = rows.flatMap((u) => (u.costUsd === undefined ? [] : [u.costUsd]));
    return {
      harnessId,
      name: harnessId === "claude-code" ? "Claude Code" : harnessId,
      calls: total.calls,
      tokens: Math.min(
        Number.MAX_SAFE_INTEGER,
        total.input + total.output + total.cacheRead + total.cacheWrite,
      ),
      wallSeconds: total.wallSeconds,
      ...(costs.length ? { estimatedCostUsd: costs.reduce((a, b) => a + b, 0) } : {}),
    };
  });
  const billedRows = usageRows.filter((row) => row.billing !== "plan");
  const billedCost = billedRows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  return RunDetail.parse({
    ...toRunSummary(
      run,
      manifest.name,
      lines[0],
      view.waiting?.run,
      runTrigger(run, flowNameOf),
      currentHash,
      currentStep(view),
    ),
    inputs,
    steps,
    approvalIds: view.approvals.map((a) => a.id),
    outputs,
    usage: harnesses,
    calls: usageRows.map(({ harness, wallMs, queuedMs, ...row }) => ({
      ...row,
      models: row.models.map((model) => ({
        ...model,
        input: Math.min(Number.MAX_SAFE_INTEGER, model.input),
        output: Math.min(Number.MAX_SAFE_INTEGER, model.output),
        cacheRead: Math.min(Number.MAX_SAFE_INTEGER, model.cacheRead),
        cacheWrite: Math.min(Number.MAX_SAFE_INTEGER, model.cacheWrite),
      })),
      harnessId: harness,
      wallSeconds: wallMs / 1000,
      queuedSeconds: queuedMs / 1000,
    })),
    estimatedCostUsd: usageRows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    report: {
      runId: run.id,
      lines,
      decisionLines: run.decisionLines ?? [],
      result: { kind: run.result?.kind ?? "report" },
    },
    decisionLines: run.decisionLines ?? [],
    costLine:
      usageRows.length > 0 && billedRows.length === 0
        ? { kind: "plan" }
        : billedCost > 0
          ? { kind: "amount", usd: billedCost }
          : { kind: "none" },
    canRunAgain: flowExists,
    canTryAgain: run.state === "blocked" || run.state === "interrupted" || run.state === "needs_login",
    blockedReason: run.blockedReason,
  });
}
export { toAuditRecord } from "./map-run-v1.ts";

export function runTrigger(
  run: RunRow,
  flowNameOf: (id: string) => string | undefined,
): { kind: string; words: string } | undefined {
  if (!run.trigger) return undefined;
  const words = triggerWords(run.trigger.kind, run.trigger.payload, flowNameOf);
  return words ? { kind: run.trigger.kind, words } : undefined;
}
