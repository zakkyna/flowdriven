import {
  evaluate,
  type FlowManifest,
  interpolate,
  type LeafStep,
  type Scope,
  truthy,
  type Value,
} from "@flowdriven/sdk";
import { defaultCommandRunner } from "../checks/command.ts";
import { runChecks } from "../checks/run-checks.ts";
import type { ResolvedDeps } from "../engine.ts";
import type { RunRow, StepRow } from "../storage.ts";
import { limits } from "./limits.ts";
export async function runLeaf(
  step: LeafStep,
  ctx: { deps: ResolvedDeps; run: RunRow; manifest: FlowManifest; scope: Scope; itemKey: string },
): Promise<"passed" | "skipped" | "failed" | "halt"> {
  const { deps, run, manifest, scope, itemKey } = ctx;
  const { store, harness, now, newId } = deps;
  const row: StepRow = store.getStep(run.id, step.id, itemKey) ?? {
    runId: run.id,
    stepId: step.id,
    itemKey,
    state: "pending",
    attempts: [],
    outputs: {},
    checks: [],
  };
  const save = () => store.upsertStep(row);
  const block = (note: string) => {
    row.state = "failed";
    row.note = note;
    save();
    store.updateRun(run.id, { state: "blocked", blockedReason: note });
  };
  try {
    if (step.when && !truthy(evaluate(step.when, scope))) {
      row.state = "skipped";
      row.note = "skipped: condition false";
      save();
      return "skipped";
    }
  } catch (e) {
    block(e instanceof Error ? e.message : "Invalid condition");
    return "halt";
  }
  if (step.do === "ask") {
    block("Ask steps cannot run as leaf steps.");
    return "halt";
  }
  if (step.do === "flow") {
    block("do: flow is not run by this engine yet");
    return "halt";
  }
  if (step.do === "builtin" && !Object.hasOwn(deps.builtins, step.builtin)) {
    block("unknown builtin");
    return "halt";
  }
  let instructions = "";
  try {
    if (step.do !== "builtin") instructions = interpolate(step.instructions, scope);
  } catch (e) {
    block(e instanceof Error ? e.message : "Invalid instructions");
    return "halt";
  }
  const { duration, attempts } = limits(step, manifest);
  const failures: string[] = [];
  for (let n = 1; n <= attempts; n++) {
    const replan = n === step.retry + 2;
    const ctl = new AbortController();
    if (replan && step.do !== "builtin") {
      try {
        const plan = await harness.replan({
          runId: run.id,
          stepId: step.id,
          itemKey,
          instructions,
          failures,
          signal: ctl.signal,
        });
        if (!plan) break;
        instructions = plan.instructions;
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "replan failed");
        break;
      }
    }
    row.state = "running";
    store.updateRun(run.id, { state: "running" });
    const attempt = { number: n, replan, worker: harness.name, startedAt: now().toISOString() };
    row.attempts.push(attempt);
    save();
    let failure = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, duration);
    try {
      let result: {
        exit: "ok" | "failed" | "quota" | "auth" | "interrupted";
        text: string;
        outputs: Record<string, Value>;
      };
      if (step.do === "builtin") {
        const fn = deps.builtins[step.builtin];
        if (!fn) throw new Error("unknown builtin");
        result = { exit: "ok", text: "", outputs: await fn((step.with ?? {}) as Record<string, Value>, run) };
      } else {
        result = await harness.runStep({
          runId: run.id,
          stepId: step.id,
          itemKey,
          attempt: n,
          replan,
          kind: step.do,
          title: step.title ?? step.id,
          instructions,
          uses: step.uses,
          ...(step.do === "skill" ? { skill: step.skill } : {}),
          outputs: step.outputs.map(({ id, type }) => ({ id, type })),
          ...(failures.length ? { lastFailure: failures.at(-1) } : {}),
          maxDurationMs: duration,
          signal: ctl.signal,
        });
      }
      if (timedOut) failure = "time limit exceeded";
      else if (result.exit === "quota" || result.exit === "auth") {
        Object.assign(attempt, { endedAt: now().toISOString(), exit: result.exit });
        block(
          result.exit === "quota" ? "The harness has no quota left." : "The harness needs you to sign in.",
        );
        return "halt";
      } else if (result.exit === "interrupted") {
        Object.assign(attempt, { endedAt: now().toISOString(), exit: "interrupted" });
        row.state = "interrupted";
        save();
        store.updateRun(run.id, { state: "interrupted" });
        return "halt";
      } else if (result.exit !== "ok") failure = "worker failed";
      else {
        const missing = step.outputs.find((o) => !Object.hasOwn(result.outputs, o.id));
        if (missing) failure = `missing output ${missing.id}`;
        else {
          const outputs = Object.fromEntries(step.outputs.map((o) => [o.id, result.outputs[o.id]])) as Record<
            string,
            Value
          >;
          const flow = store.getFlow(run.flowId, run.flowHash);
          if (!flow) throw new Error("flow not found");
          row.checks = await runChecks(step.checks, {
            runId: run.id,
            stepId: step.id,
            itemKey,
            folder: run.project,
            files: new Map(Object.entries(flow.files)),
            declaredOutputs: step.outputs.map((o) => o.id),
            output: { text: result.text, values: outputs },
            bind: (text) => interpolate(text, scope),
            harness,
            signal: ctl.signal,
            runCommand: deps.runCommand ?? defaultCommandRunner(),
          });
          const failed = row.checks.find((c) => c.required && c.verdict === "failed");
          if (timedOut) failure = "time limit exceeded";
          else if (failed) failure = failed.evidence ?? failed.summary;
          else {
            row.outputs = outputs;
            Object.assign(attempt, { endedAt: now().toISOString() });
            if (row.checks.some((c) => c.required && c.verdict === "pending")) {
              const createdAt = now().toISOString();
              row.state = "waiting_approval";
              save();
              store.createApproval({
                id: newId("ap"),
                kind: "result_sign_off",
                runId: run.id,
                stepId: step.id,
                itemKey,
                summary: `Approve the result of "${step.title ?? step.id}"`,
                payload: result.text.slice(0, 4000),
                approves: [],
                onExpiry: "fail",
                createdAt,
                expiresAt: new Date(Date.parse(createdAt) + 86400000).toISOString(),
                state: "pending",
              });
              store.updateRun(run.id, { state: "waiting_approval" });
              return "halt";
            }
            Object.assign(attempt, { exit: "ok" });
            row.state = "passed";
            save();
            return "passed";
          }
        }
      }
    } catch (e) {
      failure = timedOut ? "time limit exceeded" : e instanceof Error ? e.message : "worker failed";
    } finally {
      clearTimeout(timer);
    }
    Object.assign(attempt, { endedAt: now().toISOString(), exit: "failed" });
    failures.push(failure);
    row.state = "retrying";
    row.note = failure;
    save();
    store.updateRun(run.id, { state: "retrying" });
  }
  block(
    `Blocked at step "${step.title ?? step.id}": checks still failing after ${row.attempts.length} attempts.`,
  );
  return "failed";
}
