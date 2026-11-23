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
import { visible } from "../claude/text.ts";
import { callGrant } from "../connectors/grants.ts";
import type { ResolvedDeps } from "../engine.ts";
import type { StepResult } from "../harness.ts";
import type { RunRow, StepRow } from "../storage.ts";
import { approvedCallsOf, HOLD_TEXT, heldPayload, labelOf, MAX_HOLDS, sendCapable } from "./held.ts";
import { limits } from "./limits.ts";
import { stepTakesOutsideText } from "./outside.ts";
import { OWN_TEXT, ownTextHash, ownTextRefusal } from "./own-text.ts";
import { loopsOverChoice } from "./pick-keys.ts";
import { raceAbort } from "./timeout.ts";

export const LONG_STEP_MS = 30 * 60 * 1000;
export const LONG_STEP = {
  timedOut: (minutes: number) =>
    `This step ran for its whole time limit of ${minutes} minutes, so FlowDriven does not try it again.`,
};

export async function runLeaf(
  step: LeafStep,
  ctx: {
    deps: ResolvedDeps;
    run: RunRow;
    manifest: FlowManifest;
    scope: Scope;
    itemKey: string;
    keepWaiting?: boolean;
  },
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
  const block = (note: string, stepNote = note) => {
    row.state = "failed";
    row.note = stepNote;
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
  if (
    step.do !== "builtin" &&
    row.outside !== true &&
    stepTakesOutsideText(step, manifest, run, itemKey, store.listSteps(run.id))
  ) {
    row.outside = true;
    save();
  }
  const { duration, attempts, replanAt, mediumAt } = limits(step, manifest);
  row.limitMs = duration;
  const failures: string[] = [];
  for (let n = 1; n <= attempts; n++) {
    const replan = n === replanAt;
    const ctl = new AbortController();
    const active = deps.active.get(run.id) ?? new Set<AbortController>();
    active.add(ctl);
    deps.active.set(run.id, active);
    row.state = "running";
    if (!ctx.keepWaiting) store.updateRun(run.id, { state: "running" });
    const attempt = { number: n, replan, worker: harness.name, startedAt: now().toISOString() };
    row.attempts.push(attempt);
    save();
    let failure = "";
    let timedOut = false;
    let remaining = duration;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let armedAt = 0;
    let paused = false;
    let ended = false;
    const arm = () => {
      armedAt = Date.now();
      const chunk = Math.min(remaining, 2_147_483_647);
      timer = setTimeout(() => {
        remaining -= chunk;
        if (remaining > 0) arm();
        else {
          timedOut = true;
          ctl.abort();
        }
      }, chunk);
    };
    const pauseLimit = () => {
      if (paused || ended) return () => {};
      paused = true;
      clearTimeout(timer);
      remaining = Math.max(1, remaining - (Date.now() - armedAt));
      return () => {
        if (ended || !paused) return;
        paused = false;
        arm();
      };
    };
    arm();
    try {
      if (replan && step.do !== "builtin") {
        const plan = await raceAbort(
          harness.replan({
            runId: run.id,
            stepId: step.id,
            itemKey,
            instructions,
            failures,
            signal: ctl.signal,
          }),
          ctl.signal,
        );
        if (store.getRun(run.id)?.state === "stopped") return "halt";
        if (!plan) {
          row.attempts.pop();
          break;
        }
        instructions = plan.instructions;
      }
      let result: StepResult;
      if (step.do === "builtin") {
        const fn = deps.builtins[step.builtin];
        if (!fn) throw new Error("unknown builtin");
        result = {
          exit: "ok",
          text: "",
          outputs: await raceAbort(fn((step.with ?? {}) as Record<string, Value>, run), ctl.signal),
        };
      } else {
        const home = manifest.steps.find(
          (s) => "for_each" in s && s.steps.some((nested) => nested.id === step.id),
        );
        const ask =
          home &&
          manifest.steps.find(
            (s) => "do" in s && s.do === "ask" && loopsOverChoice(manifest, s.id).includes(home.id),
          );
        const pickTools = ask && "do" in ask && ask.do === "ask" ? ask.ask.approves : [];
        const approvedCalls = approvedCallsOf(store, run.id, step.id, itemKey);
        result = await raceAbort(
          harness.runStep({
            runId: run.id,
            stepId: step.id,
            itemKey,
            pickTools,
            attempt: n,
            replan,
            kind: step.do,
            title: step.title ?? step.id,
            instructions,
            uses: step.uses,
            project: run.project,
            requirements: step.uses.flatMap((id) => run.requirements.filter((r) => r.id === id)),
            routes: run.routes ?? [],
            takesOutside: stepTakesOutsideText(step, manifest, run, itemKey, store.listSteps(run.id)),
            ...(approvedCalls.length ? { approvedCalls } : {}),
            onOutside: () => {
              row.outside = true;
              save();
            },
            ...(mediumAt !== undefined && n >= mediumAt
              ? { effort: "medium" as const }
              : step.worker?.effort === undefined
                ? {}
                : { effort: step.worker.effort }),
            ...(step.do === "skill" ? { skill: step.skill } : {}),
            outputs: step.outputs.map(({ id, type }) => ({ id, type })),
            ...(failures.length ? { lastFailure: failures.at(-1) } : {}),
            pauseLimit,
            ...(duration > LONG_STEP_MS && deps.keepAwake ? { onStart: deps.keepAwake } : {}),
            maxDurationMs: duration,
            signal: ctl.signal,
          }),
          ctl.signal,
        );
      }
      if (store.getRun(run.id)?.state === "stopped") return "halt";
      if (result.outside === true) row.outside = true;
      if (result.hold) {
        const hold = result.hold;
        const payload = heldPayload(hold.input, hold.tool);
        if (payload === undefined) {
          Object.assign(attempt, { endedAt: now().toISOString(), exit: "failed" });
          row.noteLine = { key: "hold.tooLarge" };
          block(HOLD_TEXT.tooLarge);
          store.updateRun(run.id, {
            cause: { code: "step_failed", params: { step: step.title ?? step.id } },
          });
          return "failed";
        }
        const recipients =
          payload &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          payload.kind === "email" &&
          Array.isArray(payload.to)
            ? payload.to.join(", ")
            : undefined;
        const replyTitle =
          /(?:^|__)reply$/.test(hold.tool) && recipients && recipients.length <= 150
            ? `Send reply to ${recipients}?`
            : undefined;
        const grant = callGrant(hold.requirementId, hold.tool, hold.digest);
        const holds = store
          .listApprovals({ runId: run.id })
          .filter((a) => a.kind === "risky_action" && a.stepId === step.id && a.itemKey === itemKey);
        const pending = holds.find(
          (a) => a.state === "pending" && a.approves.length === 1 && a.approves.at(0) === grant,
        );
        if (!pending && holds.length >= MAX_HOLDS) {
          Object.assign(attempt, { endedAt: now().toISOString(), exit: "failed" });
          row.noteLine = { key: "hold.tooMany" };
          block(HOLD_TEXT.tooMany);
          store.updateRun(run.id, {
            cause: { code: "step_failed", params: { step: step.title ?? step.id } },
          });
          return "failed";
        }
        store.transaction(() => {
          row.attempts.pop();
          row.state = "waiting_approval";
          save();
          if (!pending) {
            const createdAt = now().toISOString();
            const approvalId = newId("ap");
            const chatId = store.getRun(run.id)?.start?.chatId;
            store.createApproval({
              id: approvalId,
              ...(chatId ? { chatId } : {}),
              ...(hold.touchId && (hold.effect === "send" || hold.effect === "post")
                ? { similarGroup: `${hold.effect}:${run.flowId}:${hold.touchId}` }
                : {}),
              kind: "risky_action",
              ...(hold.action === undefined ? {} : { riskyAction: hold.action }),
              ...(hold.effect === undefined ? {} : { effect: hold.effect }),
              ...(hold.touchId === undefined ? {} : { touchId: hold.touchId }),
              ...(hold.place === undefined ? {} : { place: hold.place }),
              ...(hold.fixedPlace === undefined ? {} : { fixedPlace: hold.fixedPlace }),
              runId: run.id,
              stepId: step.id,
              itemKey,
              summary:
                replyTitle ??
                `${visible(step.title ?? step.id, 80)}: ${hold.tool} on ${labelOf(run.requirements, hold.requirementId)}`,
              payload,
              call: { tool: hold.tool, input: hold.input },
              approves: [grant],
              onExpiry: "fail",
              createdAt,
              expiresAt: new Date(Date.parse(createdAt) + 86400000).toISOString(),
              state: "pending",
              ...(row.outside === true ? { outside: true } : {}),
            });
            if (chatId) {
              const card = { type: "decision", state: "open" as const, approvalId };
              store.putMessage({
                id: newId("message"),
                chatId,
                seq: (store.listMessages(chatId).at(-1)?.seq ?? 0) + 1,
                at: createdAt,
                role: "flowdriven",
                kind: "card",
                outside: false,
                card,
              });
            }
          }
          store.updateRun(run.id, { state: "waiting_approval" });
        });
        return "halt";
      }
      if (result.block !== undefined) {
        Object.assign(attempt, { endedAt: now().toISOString(), exit: "failed" });
        if (result.noteLine) row.noteLine = result.noteLine;
        block(result.block);
        store.updateRun(run.id, { cause: result.cause ?? { code: "step_failed" } });
        return "halt";
      }
      if (result.noRetry !== undefined) {
        Object.assign(attempt, { endedAt: now().toISOString(), exit: "failed" });
        block(result.noRetry);
        return "failed";
      }
      if (timedOut) failure = "time limit exceeded";
      else if (result.exit === "quota" || result.exit === "auth") {
        Object.assign(attempt, { endedAt: now().toISOString(), exit: result.exit });
        if (result.exit === "auth") {
          const cause: { code: "site_sign_in" | "agent_signed_out"; params: Record<string, string> } =
            result.site
              ? { code: "site_sign_in" as const, params: { site: result.site } }
              : { code: "agent_signed_out" as const, params: { agent: run.agent?.agent ?? "claude-code" } };
          const at = now().toISOString();
          row.state = "failed";
          row.note = "The harness needs you to sign in.";
          save();
          store.updateRun(run.id, {
            state: "needs_login",
            blockedReason: row.note,
            cause,
            needsLoginSince: at,
          });
          store.appendAudit({
            at,
            kind: "run_blocked",
            runId: run.id,
            detail: { runId: run.id, state: "needs_login", cause },
          });
        } else block("The harness has no quota left.");
        return "halt";
      } else if (result.exit === "interrupted") {
        Object.assign(attempt, { endedAt: now().toISOString(), exit: "interrupted" });
        row.state = "interrupted";
        store.transaction(() => {
          save();
          store.updateRun(run.id, {
            state: "interrupted",
            cause: {
              code: "crash",
              ...(sendCapable(store, row, manifest) ? { params: { step: row.stepId } } : {}),
            },
          });
        });
        return "halt";
      } else if (result.exit !== "ok") failure = "worker failed";
      else {
        const missing = step.outputs.find((o) => !Object.hasOwn(result.outputs, o.id));
        if (missing)
          failure = step.checks.some((c) => c.type === "user" && c.own_text === true)
            ? OWN_TEXT.missing
            : `missing output ${missing.id}`;
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
            filesFolder: result.workFolder,
            files: new Map(Object.entries(flow.files)),
            declaredOutputs: step.outputs.map((o) => o.id),
            output: { text: result.text, values: outputs },
            bind: (text) => interpolate(text, scope),
            harness: {
              id: harness.id,
              name: harness.name,
              runStep: (req) => harness.runStep(req),
              replan: (req) => harness.replan(req),
              judge: (req) => harness.judge({ ...req, pauseLimit }),
              probe: (req) => harness.probe(req),
            },
            signal: ctl.signal,
            runCommand: deps.runCommand ?? defaultCommandRunner(),
          });
          const failed = row.checks.find((c) => c.required && c.verdict === "failed");
          if (timedOut) failure = "time limit exceeded";
          else if (failed) failure = failed.evidence ?? failed.summary;
          else {
            row.outputs = outputs;
            const pending = row.checks.some((c) => c.required && c.verdict === "pending");
            const ownCheck =
              pending &&
              step.checks.some((c) => c.type === "user" && c.required !== false && c.own_text === true);
            const output = step.outputs.at(0)?.id;
            const value = output === undefined ? undefined : outputs[output];
            const refusal = ownCheck ? ownTextRefusal(value) : undefined;
            if (refusal) {
              failure = refusal;
            } else if (pending) {
              Object.assign(attempt, { endedAt: now().toISOString() });
              const createdAt = now().toISOString();
              row.state = "waiting_approval";
              store.transaction(() => {
                save();
                store.createApproval({
                  id: newId("ap"),
                  kind: "result_sign_off",
                  ...(row.outside === true ? { outside: true } : {}),
                  runId: run.id,
                  stepId: step.id,
                  itemKey,
                  summary: ownCheck
                    ? OWN_TEXT.summary(visible(interpolate(step.title ?? step.id, scope), 80))
                    : `Approve the result of "${step.title ?? step.id}"`,
                  payload: ownCheck && typeof value === "string" ? value : result.text.slice(0, 4000),
                  ...(ownCheck && output !== undefined && typeof value === "string"
                    ? { ownText: { output, hash: ownTextHash(value) } }
                    : {}),
                  approves: [],
                  onExpiry: "fail",
                  createdAt,
                  expiresAt: new Date(Date.parse(createdAt) + 86400000).toISOString(),
                  state: "pending",
                });
                store.updateRun(run.id, { state: "waiting_approval" });
              });
              return "halt";
            } else {
              Object.assign(attempt, { endedAt: now().toISOString(), exit: "ok" });
              row.state = "passed";
              save();
              return "passed";
            }
          }
        }
      }
    } catch (e) {
      failure = timedOut ? "time limit exceeded" : e instanceof Error ? e.message : "worker failed";
    } finally {
      ended = true;
      clearTimeout(timer);
      active.delete(ctl);
      if (active.size === 0) deps.active.delete(run.id);
    }
    if (store.getRun(run.id)?.state === "stopped") return "halt";
    Object.assign(attempt, { endedAt: now().toISOString(), exit: "failed" });
    if (timedOut && duration > LONG_STEP_MS && n < attempts) {
      block(LONG_STEP.timedOut(Math.round(duration / 60_000)));
      return "failed";
    }
    failures.push(failure);
    row.state = "retrying";
    row.note = failure;
    save();
    if (!ctx.keepWaiting) store.updateRun(run.id, { state: "retrying" });
  }
  block(
    `Blocked at step "${step.title ?? step.id}": checks still failing after ${row.attempts.length} attempts.`,
    failures.at(-1) === "time limit exceeded" ? "time limit exceeded" : undefined,
  );
  return "failed";
}
