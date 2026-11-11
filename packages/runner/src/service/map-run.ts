import {
  AuditRecord,
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
import { reportLines } from "../report.ts";
import type { AuditEntry, RunRow, StepRow } from "../storage.ts";
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
      entry.kind !== "tool_denied" ||
      !detail ||
      typeof detail !== "object" ||
      Array.isArray(detail) ||
      detail.stepId !== stepId ||
      detail.itemKey !== itemKey ||
      typeof detail.tool !== "string" ||
      typeof detail.reason !== "string"
    )
      continue;
    const existing = rows.find((row) => row.tool === detail.tool && row.reason === detail.reason);
    if (existing) existing.count++;
    else if (rows.length < 20) rows.push({ tool: detail.tool, reason: detail.reason, count: 1 });
  }
  return rows.length ? rows : undefined;
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
export function toRunSummary(run: RunRow, flowName: string, reportFirstLine?: string): RunSummary {
  return RunSummary.parse({
    id: run.id,
    flowId: run.flowId,
    flowName,
    flowVersion: coreVersion(run.flowVersion),
    oneTime: false,
    project: run.project,
    state: run.state,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    reportFirstLine,
  });
}
export function toRunDetail(view: RunView, harnessIdOf: (workerName: string) => string): RunDetail {
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
      note: row?.note,
      picks,
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
  return RunDetail.parse({
    ...toRunSummary(run, manifest.name, lines[0]),
    inputs,
    steps,
    approvalIds: view.approvals.map((a) => a.id),
    outputs,
    usage: [],
    estimatedCostUsd: 0,
    report: { runId: run.id, lines, saveOffer: false },
    blockedReason: run.blockedReason,
  });
}
export function toAuditRecord(entry: AuditEntry): AuditRecord {
  return AuditRecord.parse({ ...entry, detail: JSON.stringify(entry.detail) });
}
