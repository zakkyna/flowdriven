import {
  type CallInfo,
  type HarnessAdapter,
  HarnessCallError,
  type JudgeRequest,
  type StepRequest,
} from "../harness.ts";
import type { ExitClass } from "../states.ts";
import type { UsageEventRow } from "../storage.ts";
import { KeeperAbortError } from "./keeper.ts";
import type { Keeper, Slot, Ticket } from "./types.ts";

type Deps = {
  inner: HarnessAdapter;
  keeper: Keeper;
  nowMs: () => number;
  at: () => string;
  info: (
    runId: string,
  ) => { cls: 0 | 1 | 2; underWay: boolean; startedAt: string; flowId: string } | undefined;
  weight: (q: {
    flowId: string;
    stepId: string;
    kind: "worker" | "judge";
    harnessId: string;
    connectors: number;
  }) => number;
  record: (row: UsageEventRow) => void;
};
export function createKeptHarness(deps: Deps): HarnessAdapter {
  const { inner, keeper } = deps;
  const missing = "FlowDriven could not find the run of this step.";
  async function run<T>(
    req: StepRequest | JudgeRequest,
    kind: "worker" | "judge",
    info: NonNullable<ReturnType<Deps["info"]>>,
    invoke: (onStart: (pid: number) => void) => Promise<T & { call?: CallInfo }>,
  ): Promise<T> {
    const connectors =
      "requirements" in req
        ? req.requirements.filter((r) => r.type === "mcp_server" || r.type === "plugin").length
        : 0;
    const ticket: Ticket = {
      runId: req.runId,
      stepId: req.stepId,
      itemKey: req.itemKey ?? "",
      kind,
      harnessId: inner.id,
      cls: info.cls,
      underWay: info.underWay,
      runStartedAt: info.startedAt,
      weightMb: deps.weight({
        flowId: info.flowId,
        stepId: req.stepId,
        kind,
        harnessId: inner.id,
        connectors,
      }),
    };
    let resume: (() => void) | undefined;
    const slot: Slot = await keeper.acquire(ticket, req.signal, () => {
      queueMicrotask(() => {
        resume = req.pauseLimit?.();
      });
    });
    resume?.();
    const startedAt = deps.nowMs();
    let started = false;
    let call: CallInfo | undefined;
    let exit: ExitClass = "failed";
    try {
      const result = await invoke((pid) => {
        started = true;
        slot.attach(pid);
        req.onStart?.(pid);
      });
      call = result.call;
      exit = "exit" in result ? (result.exit as ExitClass) : "ok";
      return result;
    } catch (e) {
      if (e instanceof HarnessCallError) {
        call = e.call;
        exit = e.exit;
      }
      throw e;
    } finally {
      const { peakMb } = slot.release();
      try {
        if (call || started)
          deps.record({
            at: deps.at(),
            runId: req.runId,
            stepId: req.stepId,
            itemKey: req.itemKey ?? "",
            attempt: "attempt" in req ? req.attempt : 0,
            kind,
            harness: inner.id,
            models: call?.models ?? [],
            turns: call?.turns ?? 0,
            wallMs: call?.wallMs ?? Math.max(0, deps.nowMs() - startedAt),
            queuedMs: slot.waitedMs,
            ...(peakMb === undefined ? {} : { memoryPeakMb: peakMb }),
            exit,
            ...(call?.costUsd === undefined ? {} : { costUsd: call.costUsd }),
          });
      } catch {
        /* Recording must not replace the call result. */
      }
      try {
        if (call) keeper.noteLimits(inner.id, call.limits);
      } catch {
        /* A note must not replace the call result. */
      }
      try {
        const reset = call?.limits.find(
          (limit) => limit.status === "rejected" && limit.resetsAt !== undefined,
        )?.resetsAt;
        if (exit === "quota") keeper.noteRefused(inner.id, reset === undefined ? undefined : reset * 1000);
        else if (exit === "ok") keeper.noteSuccess(inner.id);
      } catch {
        /* A note must not replace the call result. */
      }
    }
  }
  return {
    id: inner.id,
    name: inner.name,
    async runStep(req) {
      const info = deps.info(req.runId);
      if (!info) return { exit: "failed", text: missing, outputs: {}, block: missing };
      try {
        return await run(req, "worker", info, (onStart) => inner.runStep({ ...req, onStart }));
      } catch (e) {
        if (e instanceof KeeperAbortError) return { exit: "interrupted", text: "", outputs: {} };
        throw e;
      }
    },
    async judge(req) {
      const info = deps.info(req.runId);
      if (!info) throw new Error(missing);
      try {
        return await run(req, "judge", info, (onStart) => inner.judge({ ...req, onStart }));
      } catch (e) {
        if (e instanceof KeeperAbortError) throw new Error("aborted");
        throw e;
      }
    },
    replan: (req) => inner.replan(req),
    probe: (req) => inner.probe(req),
    stop: () => {
      inner.stop?.();
      keeper.stop();
    },
  };
}
