import type { Value } from "@flowdriven/sdk";
import type {
  HarnessAdapter,
  HeldCall,
  JudgeRequest,
  JudgeResult,
  ProbeRequest,
  ProbeResult,
  ReplanRequest,
  StepRequest,
} from "./harness.ts";
import type { ExitClass } from "./states.ts";
export type Reply = {
  exit?: ExitClass;
  text?: string;
  outputs?: Record<string, Value>;
  hang?: boolean;
  block?: string;
  noRetry?: string;
  hold?: HeldCall;
  outside?: boolean;
};
export type Script = {
  steps?: Record<string, Reply | Reply[] | ((req: StepRequest) => Reply)>;
  replan?: (req: ReplanRequest) => { instructions: string } | undefined;
  judge?: (req: JudgeRequest) => JudgeResult;
  probe?: (req: ProbeRequest) => ProbeResult;
};
export interface ScriptedHarness extends HarnessAdapter {
  calls: StepRequest[];
  replanCalls: ReplanRequest[];
  judgeCalls: JudgeRequest[];
}
export function scriptedHarness(script: Script): ScriptedHarness {
  const calls: StepRequest[] = [],
    replanCalls: ReplanRequest[] = [],
    judgeCalls: JudgeRequest[] = [];
  const counts = new Map<string, number>();
  return {
    id: "scripted",
    name: "Scripted harness",
    calls,
    replanCalls,
    judgeCalls,
    async runStep(req) {
      calls.push(req);
      const itemKey = `${req.stepId}@${req.itemKey}`;
      const key = Object.hasOwn(script.steps ?? {}, itemKey) ? itemKey : req.stepId;
      const entry = Object.hasOwn(script.steps ?? {}, key) ? script.steps?.[key] : undefined;
      if (!entry) throw new Error(`no script for step ${key}`);
      let reply: Reply | undefined;
      if (Array.isArray(entry)) {
        const n = counts.get(key) ?? 0;
        counts.set(key, n + 1);
        reply = entry.at(Math.min(n, entry.length - 1));
      } else reply = typeof entry === "function" ? entry(req) : entry;
      if (!reply) throw new Error(`no script for step ${key}`);
      if (reply.hang)
        await new Promise<never>((_resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (req.signal.aborted) abort();
          else req.signal.addEventListener("abort", abort, { once: true });
        });
      return {
        exit: reply.exit ?? "ok",
        text: reply.text ?? "",
        outputs: reply.outputs ?? {},
        ...(reply.block === undefined ? {} : { block: reply.block }),
        ...(reply.noRetry === undefined ? {} : { noRetry: reply.noRetry }),
        ...(reply.hold === undefined ? {} : { hold: reply.hold }),
        ...(reply.outside === undefined ? {} : { outside: reply.outside }),
      };
    },
    async replan(req) {
      replanCalls.push(req);
      return script.replan?.(req);
    },
    async judge(req) {
      judgeCalls.push(req);
      if (!script.judge) throw new Error("no scripted judge");
      return script.judge(req);
    },
    async probe(req) {
      if (!script.probe) throw new Error("no scripted probe");
      return script.probe(req);
    },
  };
}
