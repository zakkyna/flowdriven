import type { FlowManifest } from "@flowdriven/sdk";
import type { Begun, ResolvedDeps } from "../engine.ts";
import { EngineError } from "../errors.ts";
import type { RunRow, StepRow } from "../storage.ts";

export function createRecovery(ctx: {
  deps: ResolvedDeps;
  checkAndWalk: (run: RunRow) => Promise<RunRow>;
  sweep: () => void;
  enqueue: (run: RunRow, task: () => Promise<RunRow>) => Begun;
  assertRunning: () => void;
  blockError: (id: string, error: unknown) => RunRow;
  flowFor: (run: RunRow) => FlowManifest;
}) {
  const { store, now } = ctx.deps;
  function beginResume(id: string): Begun {
    ctx.assertRunning();
    ctx.sweep();
    const run = store.getRun(id);
    if (!run) throw new EngineError("not_found", "Run not found.");
    if (!["blocked", "failed", "interrupted", "needs_login"].includes(run.state))
      throw new EngineError("not_allowed", "This run cannot be resumed.");
    try {
      ctx.flowFor(run);
      store.transaction(() => {
        for (const row of store.listSteps(id)) {
          if (row.state === "failed" || row.state === "interrupted")
            store.upsertStep({ ...row, state: "pending", attempts: [], note: undefined });
        }
        for (const item of store.listItems(id)) {
          if (
            item.status === "failed" ||
            item.status === "running" ||
            (item.status === "skipped" && item.note === "skipped: stopped after an item failed")
          )
            store.upsertItem({ ...item, status: "pending", note: undefined });
        }
        store.updateRun(id, { state: "checking", blockedReason: undefined, endedAt: undefined });
      });
      const updated = store.getRun(id);
      if (!updated) throw new EngineError("not_found", "Run not found.");
      return ctx.enqueue(updated, () => ctx.checkAndWalk(updated));
    } catch (error) {
      const blocked = ctx.blockError(id, error);
      return { run: blocked, settled: Promise.resolve(blocked) };
    }
  }
  function isIdempotent(row: StepRow, manifest: FlowManifest): boolean {
    if (!row.itemKey) {
      const step = manifest.steps.find((candidate) => candidate.id === row.stepId);
      return step !== undefined && !("for_each" in step) && step.idempotent === true;
    }
    const loops = manifest.steps.filter((step) => "for_each" in step);
    const matching = loops.flatMap((loop) => {
      if (!("for_each" in loop)) return [];
      const item = store
        .listItems(row.runId, loop.id)
        .find((i) => i.key === row.itemKey && i.status === "running");
      return item ? loop.steps.filter((step) => step.id === row.stepId) : [];
    });
    return matching.length === 1 && matching.at(0)?.idempotent === true;
  }
  function beginRecover(): { runs: RunRow[]; settled: Promise<RunRow[]> } {
    ctx.assertRunning();
    const resumed: Begun[] = [];
    for (const run of store
      .listRuns()
      .filter((r) => ["queued", "checking", "running", "retrying"].includes(r.state))) {
      try {
        const manifest = ctx.flowFor(run);
        const pending = store.listApprovals({ runId: run.id, state: "pending" });
        const interrupted = store
          .listSteps(run.id)
          .filter(
            (row) =>
              row.state === "running" ||
              row.state === "retrying" ||
              (row.state === "waiting_approval" &&
                !pending.some((a) => a.stepId === row.stepId && a.itemKey === row.itemKey)),
          );
        const previouslyInterrupted = store.listSteps(run.id).filter((row) => row.state === "interrupted");
        const safe = [...interrupted, ...previouslyInterrupted].every((row) => isIdempotent(row, manifest));
        store.transaction(() => {
          for (const row of interrupted) store.upsertStep({ ...row, state: "interrupted" });
          store.updateRun(run.id, { state: "interrupted", cause: { code: "crash" } });
          store.appendAudit({ at: now().toISOString(), kind: "run_interrupted", runId: run.id, detail: {} });
        });
        if (safe) resumed.push(beginResume(run.id));
      } catch (error) {
        ctx.blockError(run.id, error);
      }
    }
    return { runs: resumed.map((b) => b.run), settled: Promise.all(resumed.map((b) => b.settled)) };
  }
  async function resumeRun(id: string): Promise<RunRow> {
    return beginResume(id).settled;
  }
  async function recoverAfterCrash(): Promise<RunRow[]> {
    return beginRecover().settled;
  }
  return { beginResume, beginRecover, resumeRun, recoverAfterCrash };
}
