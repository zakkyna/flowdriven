import type { Value } from "@flowdriven/sdk";
import type { GrantBook } from "../connectors/grants.ts";
import { isCallGrant } from "../connectors/grants.ts";
import type { CallInfo, HeldCall, RateLimit } from "../harness.ts";
import { buildClaudeArgs, type ClaudeModel } from "./args.ts";
import { BROWSER_DENY, CHROME_PREFIX, closeSentence } from "./browser.ts";
import { decidePost, POST_TEXT, type PostResult, postLine, STOP } from "./browser-post.ts";
import { startChannel } from "./channel.ts";
import { startChild } from "./child.ts";
import { CONNECTOR_DENY, CONNECTOR_STOP, hideConnectorIds, mcpConfigText } from "./connector.ts";
import { type ConnectorPostResult, decideConnectorPost } from "./connector-post.ts";
import { createControlDir, removeControlDir, writeMcpConfig } from "./control.ts";
import { DENY, decide } from "./decide.ts";
import { childEnv } from "./env.ts";
import { createAttemptState, type PageCounter } from "./pages.ts";
import type { Policy } from "./policy.ts";
import {
  checkFirstEvent,
  createTripwire,
  isAuthFailure,
  isRateLimited,
  LIMITS_NOT_APPLIED,
  LineReader,
  MAX_START_HOOK_EVENTS,
  parseEvent,
  parseRateLimit,
  parseResult,
  type ResultInfo,
  startHookEvent,
  tripSentence,
} from "./stream.ts";
import { visible } from "./text.ts";
export const MAX_DENIED_ENTRIES = 50;
const MAX_PAGE_ROWS = 50;
export type RunInput = {
  pickTools?: string[];
  runId: string;
  stepId: string;
  ruleTitle?: string;
  itemKey: string;
  attempt: number;
  model: ClaudeModel;
  schema?: object;
  signal: AbortSignal;
  onStart?: (pid: number) => void;
  browser?: boolean;
  connectorPrefix?: string;
  onOutside?: () => void;
  books?: { grants?: GrantBook; rules?: () => import("../storage.ts").RuleRow[]; earlierNo?: () => boolean };
  makePolicy: (control: { root: string; cwd: string }, sessionId: string) => Policy;
  makePrompt: (policy: Policy) => string;
};
export type Outcome =
  | { kind: "ok"; text: string; structured?: unknown }
  | { kind: "auth" }
  | { kind: "quota" }
  | { kind: "interrupted" }
  | {
      kind: "block";
      sentence: string;
      cause?: import("../harness.ts").StepResult["cause"];
      noteLine?: import("../harness.ts").StepResult["noteLine"];
    }
  | { kind: "stop"; sentence: string }
  | { kind: "hold"; held: HeldCall }
  | { kind: "failed"; text: string };
export type RunDeps = {
  grants?: GrantBook;
  pages?: PageCounter;
  onCall?: (call: CallInfo) => void;
  nowMs?: () => number;
  claudePath: string;
  env: Record<string, string | undefined>;
  controlRoot: string;
  newId: (prefix: string) => string;
  newSessionId: () => string;
  audit: (kind: string, runId: string, detail: Value) => void;
  rounds: number;
  pollMs: number;
  graceMs: number;
  killGroup?: (pid: number, signal: NodeJS.Signals) => void;
  exitWaitMs: number;
  closeWaitMs?: number;
  maxLineBytes: number;
  maxDeniedEntries?: number;
  recordRule?: (ruleId: string, tool: string, at: string) => void;
  beforeAllow?: () => void;
  afterAllow?: () => void;
  register?: (stop: (sentence?: string) => void) => () => void;
};
export async function runClaude(input: RunInput, deps: RunDeps): Promise<Outcome> {
  const id = deps.newId("cc");
  const sessionId = deps.newSessionId();
  const dir = createControlDir({
    root: deps.controlRoot,
    id,
    rounds: deps.rounds,
    browser: input.browser,
    connectorPrefix: input.connectorPrefix,
  });
  let channel: ReturnType<typeof startChannel> | undefined;
  let child: ReturnType<typeof startChild> | undefined;
  let interrupted = false;
  let abort = false;
  let forced: Outcome | undefined;
  let pendingStop: { id: string; outcome: Outcome } | undefined;
  let closing: { tab: number } | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let result: ResultInfo | undefined;
  const counts = { allowed: 0, held: 0, refused: 0 };
  const approvedPages = new Map<number, string>();
  let notListed = 0;
  const limits: RateLimit[] = [];
  const nowMs = deps.nowMs ?? Date.now;
  let startedAt: number | undefined;
  const detail = { stepId: input.stepId, itemKey: input.itemKey, attempt: input.attempt };
  const audit = (kind: string, data: Value) => {
    try {
      deps.audit(kind, input.runId, data);
    } catch {}
  };
  const unregister = deps.register?.((sentence) => {
    if (sentence === undefined) interrupted = true;
    else forced = { kind: "block", sentence };
    child?.kill();
    channel?.stop();
    removeControlDir(dir);
  });
  const onAbort = () => {
    abort = true;
    channel?.stop();
    child?.stop();
  };
  try {
    let policy: Policy;
    try {
      policy = input.makePolicy({ root: deps.controlRoot, cwd: dir.cwd }, sessionId);
    } catch (error) {
      return {
        kind: "block",
        sentence: error instanceof Error ? error.message : "FlowDriven could not check this step.",
      };
    }
    let mcpConfigPath: string | undefined;
    if (policy.connector) {
      if (input.connectorPrefix !== policy.connector.prefix)
        return { kind: "block", sentence: LIMITS_NOT_APPLIED };
      try {
        mcpConfigPath = writeMcpConfig(dir, mcpConfigText(policy.connector));
      } catch {
        return { kind: "block", sentence: LIMITS_NOT_APPLIED };
      }
    } else if (input.connectorPrefix !== undefined) return { kind: "block", sentence: LIMITS_NOT_APPLIED };
    let attempt: ReturnType<typeof createAttemptState> | undefined;
    const posts = new Map<string, PostResult>();
    const postTabs = new Map<string, number>();
    const connectorPosts = new Map<string, ConnectorPostResult>();
    let connectorCalls = 0;
    let connectorRows = 0;
    let withheldRows = 0;
    if (policy.browser) {
      if (!deps.pages) return { kind: "block", sentence: LIMITS_NOT_APPLIED };
      try {
        const count = deps.pages.count(input.runId, policy.browser.requirementId);
        if (
          !Number.isSafeInteger(count.run) ||
          count.run < 0 ||
          !Number.isSafeInteger(count.day) ||
          count.day < 0
        )
          return { kind: "block", sentence: LIMITS_NOT_APPLIED };
        if (count.run >= policy.browser.perRun) return { kind: "stop", sentence: BROWSER_DENY.runLimit };
        if (count.day >= policy.browser.perDay) return { kind: "stop", sentence: BROWSER_DENY.dayLimit };
        attempt = createAttemptState({
          pages: deps.pages,
          runId: input.runId,
          requirementId: policy.browser.requirementId,
        });
      } catch {
        return { kind: "block", sentence: LIMITS_NOT_APPLIED };
      }
    }
    let deniedEntries = 0;
    let pageRows = 0;
    channel = startChannel({
      dir,
      prefixes: [CHROME_PREFIX, ...(policy.connector ? [policy.connector.prefix] : [])],
      decide: (call) => {
        if (pendingStop) {
          if (!closing) return { allow: false, tool: "unknown", reason: DENY.badRequest };
          if (
            !(
              call !== null &&
              typeof call === "object" &&
              "tool_name" in call &&
              call.tool_name === `${CHROME_PREFIX}tabs_close_mcp`
            )
          ) {
            const tool =
              call !== null &&
              typeof call === "object" &&
              "tool_name" in call &&
              typeof call.tool_name === "string"
                ? visible(call.tool_name, 60)
                : "";
            return { allow: false, tool, reason: BROWSER_DENY.closing };
          }
          return decide(policy, call, attempt?.state());
        }
        const decision = decide(
          policy,
          call,
          attempt?.state(),
          {
            calls: connectorCalls,
            granted: (grant) =>
              (isCallGrant(grant) || (input.pickTools?.includes(grant) ?? false)) &&
              ((input.books?.grants ?? deps.grants)?.has(input.runId, grant, input.itemKey, input.stepId) ??
                false),
          },
          {
            grants: input.books?.grants ?? deps.grants,
            rules: input.books?.rules?.(),
            earlierNo: input.books?.earlierNo,
          },
        );
        if (
          !decision.allow &&
          decision.held &&
          call !== null &&
          typeof call === "object" &&
          "tool_use_id" in call &&
          typeof call.tool_use_id === "string"
        ) {
          const held: HeldCall = {
            ...(decision.held.outsideFlow ? { outsideFlow: true as const } : {}),
            requirementId: decision.held.requirementId,
            tool: decision.held.tool,
            input: decision.held.input,
            digest: decision.held.digest,
            ...(decision.held.action === undefined ? {} : { action: decision.held.action }),
            ...("effect" in decision.held
              ? {
                  effect: decision.held.effect,
                  fixedPlace: decision.held.fixedPlace,
                  ...(decision.held.touchId === undefined ? {} : { touchId: decision.held.touchId }),
                  ...(decision.held.place === undefined ? {} : { place: decision.held.place }),
                }
              : {}),
          };
          pendingStop = { id: call.tool_use_id, outcome: { kind: "hold", held } };
          stopTimer = setTimeout(() => {
            forced = pendingStop?.outcome;
            child?.kill();
          }, deps.exitWaitMs);
        }
        if (decision.allow && decision.by === "rule" && decision.ruleId) {
          try {
            if (!deps.recordRule) throw new Error("Rule recording is unavailable.");
            deps.recordRule(decision.ruleId, decision.tool, new Date(nowMs()).toISOString());
          } catch {
            return { allow: false, tool: decision.tool, reason: CONNECTOR_DENY.held };
          }
        }
        if (decision.allow && decision.by === "grant" && decision.grant) {
          try {
            (input.books?.grants ?? deps.grants)?.useGrant(decision.grant, new Date(nowMs()).toISOString());
            audit("grant_used", {
              ...detail,
              tool: decision.grant.tool,
              grant: "call",
              ...(decision.grant.approvalId ? { approvalId: decision.grant.approvalId } : {}),
              digest: decision.grant.digest,
              ...(decision.effect ? { effect: decision.effect } : {}),
            });
          } catch {
            return { allow: false, tool: decision.tool, reason: CONNECTOR_DENY.held };
          }
        }
        if (decision.allow && decision.connector) {
          const grant = decision.connector.grant;
          if (
            grant?.kind === "call" &&
            !(
              (input.books?.grants ?? deps.grants)?.use(
                input.runId,
                grant.key,
                input.itemKey,
                input.stepId,
              ) ?? false
            )
          )
            return { allow: false, tool: decision.tool, reason: CONNECTOR_DENY.held };
          if (grant)
            audit("grant_used", {
              ...detail,
              requirementId: decision.connector.requirementId,
              tool: decision.connector.tool,
              grant: grant.kind,
            });
          connectorCalls++;
          if (connectorCalls === 1) input.onOutside?.();
          if (connectorRows++ < 50)
            audit("connector_call", {
              ...detail,
              requirementId: decision.connector.requirementId,
              tool: decision.connector.tool,
              class: decision.connector.class,
            });
        }
        if (
          decision.allow &&
          decision.tool === "Bash" &&
          call !== null &&
          typeof call === "object" &&
          "tool_input" in call &&
          call.tool_input !== null &&
          typeof call.tool_input === "object" &&
          "command" in call.tool_input &&
          typeof call.tool_input.command === "string"
        )
          audit("command_run", { ...detail, command: visible(call.tool_input.command, 300) });
        if (
          decision.allow &&
          decision.by === "grant" &&
          decision.effect === "page" &&
          call !== null &&
          typeof call === "object" &&
          "tool_input" in call &&
          call.tool_input !== null &&
          typeof call.tool_input === "object" &&
          "tabId" in call.tool_input &&
          typeof call.tool_input.tabId === "number" &&
          "url" in call.tool_input &&
          typeof call.tool_input.url === "string"
        )
          approvedPages.set(call.tool_input.tabId, call.tool_input.url);
        if (decision.allow && decision.effect === "page" && policy.browser && deps.pages && attempt) {
          deps.pages.take(input.runId, policy.browser.requirementId);
          attempt.takePage();
          input.onOutside?.();
        } else if (decision.allow && decision.effect === "tab") attempt?.openTab();
        if (
          !decision.allow &&
          (decision.tool === "Write" || decision.tool === "Edit") &&
          !policy.tools.includes(decision.tool)
        ) {
          const checked = decide({ ...policy, tools: [...policy.tools, decision.tool] }, call);
          if (!checked.allow && checked.reason === DENY.readOnly) return checked;
        }
        return decision;
      },
      post: (call) => {
        const connectorResult = policy.connector
          ? decideConnectorPost(policy.connector, sessionId, call)
          : undefined;
        if (
          connectorResult &&
          call !== null &&
          typeof call === "object" &&
          "tool_use_id" in call &&
          typeof call.tool_use_id === "string"
        ) {
          connectorPosts.set(call.tool_use_id, connectorResult);
          return { text: connectorResult.text, line: postLine(connectorResult.text) };
        }
        const tabId =
          call !== null &&
          typeof call === "object" &&
          "tool_name" in call &&
          call.tool_name === `${CHROME_PREFIX}get_page_text` &&
          "tool_input" in call &&
          call.tool_input !== null &&
          typeof call.tool_input === "object" &&
          "tabId" in call.tool_input &&
          typeof call.tool_input.tabId === "number"
            ? call.tool_input.tabId
            : undefined;
        const approvedAddress = tabId === undefined ? undefined : approvedPages.get(tabId);
        if (tabId !== undefined) approvedPages.delete(tabId);
        const r = policy.browser ? decidePost(policy.browser, sessionId, call, approvedAddress) : undefined;
        if (
          !r ||
          call === null ||
          typeof call !== "object" ||
          !("tool_use_id" in call) ||
          typeof call.tool_use_id !== "string"
        )
          return undefined;
        attempt?.learn(r.tabs ?? []);
        posts.set(call.tool_use_id, r);
        const tab =
          "tool_input" in call &&
          call.tool_input !== null &&
          typeof call.tool_input === "object" &&
          "tabId" in call.tool_input &&
          typeof call.tool_input.tabId === "number" &&
          Number.isSafeInteger(call.tool_input.tabId)
            ? call.tool_input.tabId
            : undefined;
        if (tab !== undefined) postTabs.set(call.tool_use_id, tab);
        const text =
          r.tool === "get_page_text" && (r.kind === "moved" || r.kind === "challenge") && tab !== undefined
            ? `${r.text} ${closeSentence(tab)}`
            : r.text;
        return { text, line: postLine(text) };
      },
      onPost: ({ toolUseId }) => {
        try {
          const connectorResult = connectorPosts.get(toolUseId);
          if (connectorResult && policy.connector) {
            if (connectorResult.kind === "unchecked" && withheldRows++ < 50)
              audit("connector_withheld", {
                ...detail,
                requirementId: policy.connector.requirementId,
                tool: connectorResult.tool,
                why: "unchecked",
              });
            return;
          }
          const r = posts.get(toolUseId);
          if (
            pendingStop &&
            closing &&
            r?.tool === "tabs_close_mcp" &&
            postTabs.get(toolUseId) === closing.tab
          ) {
            forced = pendingStop.outcome;
            child?.kill();
            return;
          }
          if (!r || r.tool !== "get_page_text" || !policy.browser) return;
          if (pageRows < MAX_PAGE_ROWS) {
            pageRows++;
            const address =
              r.address ??
              (r.kind === "pass" || r.kind === "cut"
                ? (/^Title: [^\r\n\u2028\u2029]*\nURL: ([^\r\n\u2028\u2029]*)\nSource element: [^\r\n\u2028\u2029]*\n---(?:\n|$)/.exec(
                    r.text,
                  )?.[1] ?? "")
                : "");
            const fields = {
              ...detail,
              requirementId: policy.browser.requirementId,
              tool: r.tool,
              address: visible(address, 300),
            };
            if (r.kind === "pass" || r.kind === "cut") audit("page_read", fields);
            else audit("page_withheld", { ...fields, why: r.kind, sentence: r.text });
          }
          if (r.kind === "moved") {
            pendingStop = { id: toolUseId, outcome: { kind: "stop", sentence: STOP.moved } };
          } else if (r.kind === "challenge") {
            pendingStop = { id: toolUseId, outcome: { kind: "block", sentence: STOP.challenge } };
          }
          if (pendingStop) {
            const tab = postTabs.get(toolUseId);
            if (tab !== undefined) closing = { tab };
            stopTimer = setTimeout(
              () => {
                forced = pendingStop?.outcome;
                child?.kill();
              },
              closing ? (deps.closeWaitMs ?? 8000) : deps.exitWaitMs,
            );
          }
        } catch {}
      },
      onUnanswered: ({ tool }) => {
        try {
          if (policy.connector) {
            if (withheldRows++ < 50)
              audit("connector_withheld", {
                ...detail,
                requirementId: policy.connector.requirementId,
                tool: tool ?? "unknown",
                why: "unchecked",
              });
            return;
          }
          if (
            !policy.browser ||
            (tool !== undefined && tool !== "get_page_text") ||
            pageRows >= MAX_PAGE_ROWS
          )
            return;
          pageRows++;
          audit("page_withheld", {
            ...detail,
            requirementId: policy.browser.requirementId,
            tool: tool ?? "unknown",
            address: "",
            why: "unchecked",
            sentence: POST_TEXT.unchecked,
          });
        } catch {}
      },
      beforeAllow: deps.beforeAllow,
      afterAllow: deps.afterAllow,
      pollMs: deps.pollMs,
      onCall: ({ decision }) => {
        if (decision.allow) counts.allowed++;
        else if (decision.outcome === "hold" || decision.held) counts.held++;
        else counts.refused++;
        if (
          !decision.allow &&
          decision.outcome !== "hold" &&
          !decision.held &&
          deniedEntries >= (deps.maxDeniedEntries ?? MAX_DENIED_ENTRIES)
        )
          notListed++;
        if (
          !decision.allow &&
          decision.outcome !== "hold" &&
          !decision.held &&
          deniedEntries < (deps.maxDeniedEntries ?? MAX_DENIED_ENTRIES)
        ) {
          deniedEntries++;
          audit("tool_denied", {
            ...detail,
            tool: decision.tool,
            reason: decision.reason,
            ...(decision.target === undefined ? {} : { target: decision.target }),
          });
        }
      },
    });
    const args = buildClaudeArgs({
      model: input.model,
      sessionId,
      tools: policy.tools,
      settingsPath: dir.settings,
      ...(mcpConfigPath === undefined ? {} : { mcpConfigPath }),
      chrome: policy.browser !== undefined,
      addDirs: policy.addDirs,
      ...(input.schema === undefined ? {} : { schema: input.schema }),
    });
    child = startChild(deps.claudePath, args, {
      cwd: policy.cwd,
      env: childEnv(deps.env),
      graceMs: deps.graceMs,
      killGroup: deps.killGroup,
    });
    if (child.pid !== undefined) {
      startedAt = nowMs();
      input.onStart?.(child.pid);
    }
    const reader = new LineReader(deps.maxLineBytes);
    const tripwire = createTripwire(
      channel.allowedIds,
      policy.browser || policy.connector ? { ids: channel.chromeIds, posted: channel.posted } : undefined,
    );
    let first = true;
    let startEvents = 0;
    let auth = false;
    let quota = false;
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) onAbort();
    child.stdout.on("data", (chunk: Buffer) => {
      if (forced || interrupted) return;
      const read = reader.push(chunk);
      if (read.overflow) {
        if (policy.browser || policy.connector) {
          // A line over the limit may hold a result that was never checked: block, never retry.
          audit("tool_unchecked", { ...detail, tool: "unknown" });
          forced = {
            kind: "block",
            sentence: tripSentence("unknown"),
            cause: { code: "step_failed", params: { step: input.stepId } },
            noteLine: { key: "step.toolRanUnchecked" },
          };
        } else forced = { kind: "failed", text: "Claude Code sent a line that was too long." };
        child?.kill();
        return;
      }
      for (const line of read.lines) {
        if (line.trim() === "") continue;
        const event = parseEvent(line);
        if (first) {
          const hook = event ? startHookEvent(event) : { is: false as const };
          if (hook.is && !hook.failed && ++startEvents <= MAX_START_HOOK_EVENTS) continue;
          first = false;
          const proof = hook.is
            ? {
                ok: false as const,
                why: hook.failed ? "The start hook failed." : "Too many events before init.",
              }
            : checkFirstEvent(event, {
                browser: policy.browser !== undefined,
                ...(policy.connector ? { connector: policy.connector } : {}),
                tools: policy.tools,
                schema: input.schema !== undefined,
                sessionId,
                started: channel?.started() ?? false,
              });
          if (!proof.ok) {
            audit("limits_not_applied", {
              ...detail,
              why: proof.why === "The start hook did not run." ? "the start hook did not run" : proof.why,
            });
            forced = {
              kind: "block",
              cause: { code: "limits_not_applied", params: { agent: "Claude Code" } },
              sentence:
                proof.why === STOP.chromeDown ||
                (policy.connector &&
                  (proof.why === CONNECTOR_STOP.changed ||
                    proof.why === CONNECTOR_STOP.down(policy.connector.label)))
                  ? proof.why
                  : LIMITS_NOT_APPLIED,
            };
            child?.kill();
            break;
          }
          continue;
        }
        if (!event) continue;
        const trip = tripwire.check(event);
        if (trip.tripped) {
          audit("tool_unchecked", { ...detail, tool: trip.tool });
          forced = {
            kind: "block",
            sentence: tripSentence(trip.tool),
            cause: { code: "step_failed", params: { step: input.stepId } },
            noteLine: { key: "step.toolRanUnchecked" },
          };
          child?.kill();
          break;
        }
        if (
          pendingStop &&
          !closing &&
          event.type === "user" &&
          event.message &&
          typeof event.message === "object" &&
          "content" in event.message &&
          Array.isArray(event.message.content) &&
          event.message.content.some(
            (block: unknown) =>
              block !== null &&
              typeof block === "object" &&
              "tool_use_id" in block &&
              block.tool_use_id === pendingStop?.id,
          )
        ) {
          forced = pendingStop.outcome;
          child?.kill();
          break;
        }
        auth ||= isAuthFailure(event);
        quota ||= isRateLimited(event);
        const limit = parseRateLimit(event, nowMs());
        if (limit && limits.length < 20) limits.push(limit);
        if (event.type === "result") {
          result = parseResult(event);
          if (exitTimer === undefined)
            exitTimer = setTimeout(() => {
              forced = { kind: "failed", text: "Claude Code did not exit after its result." };
              child?.kill();
            }, deps.exitWaitMs);
        }
      }
    });
    child.send(input.makePrompt(policy));
    const done = await child.done;
    if (interrupted) return { kind: "interrupted" };
    if (forced) return forced;
    if (pendingStop) return pendingStop.outcome;
    if (abort) return { kind: "failed", text: "The step was aborted." };
    if (auth || result?.authFailed) return { kind: "auth" };
    if (result?.ok && done.code === 0)
      return {
        kind: "ok",
        text: result.text,
        ...(result.structured === undefined ? {} : { structured: result.structured }),
      };
    if (quota || result?.apiErrorStatus === 429) return { kind: "quota" };
    return {
      kind: "failed",
      text:
        hideConnectorIds(child.stderrTail().slice(-2000).trim()) ||
        (result === undefined ? "Claude Code ended without a result." : "Claude Code reported an error."),
    };
  } finally {
    input.signal.removeEventListener("abort", onAbort);
    if (exitTimer !== undefined) clearTimeout(exitTimer);
    if (stopTimer !== undefined) clearTimeout(stopTimer);
    channel?.stop();
    audit("tool_calls", {
      ...detail,
      ...counts,
      ...(notListed ? { notListed } : {}),
    });
    if (startedAt !== undefined)
      deps.onCall?.({
        models: result?.usage?.models ?? [],
        turns: result?.usage?.turns ?? 0,
        ...(result?.usage?.costUsd === undefined ? {} : { costUsd: result.usage.costUsd }),
        wallMs: Math.max(0, nowMs() - startedAt),
        limits,
      });
    child?.kill();
    removeControlDir(dir);
    unregister?.();
  }
}
