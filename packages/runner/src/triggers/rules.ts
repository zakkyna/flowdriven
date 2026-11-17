import { type FlowManifest, type Value, validateManifest } from "@flowdriven/sdk";
import type { TriggerOutcome } from "../storage.ts";
import { MAX_QUEUED_TRIGGERED, MIN_EVERY_MS } from "./constants.ts";
import { type GrantedFolders, resolveRoot } from "./scan.ts";
import { scheduleOf } from "./schedule.ts";

type Result = { ok: true } | { ok: false; reason: string };
const missingInput = (id: string) =>
  `Input "${id}" is required and has no default, so a trigger cannot start this flow.`;

export function inputsFromDefaults(
  manifest: FlowManifest,
): { ok: true; inputs: Record<string, Value> } | { ok: false; reason: string } {
  const inputs: Record<string, Value> = {};
  for (const input of manifest.inputs) {
    const value = input.default;
    if (value === undefined) {
      if (input.required) return { ok: false, reason: missingInput(input.id) };
      continue;
    }
    if (input.type === "number" && typeof value === "number" && Number.isFinite(value))
      inputs[input.id] = value;
    else if (input.type === "bool" && typeof value === "boolean") inputs[input.id] = value;
    else if (
      input.type === "list<text>" &&
      Array.isArray(value) &&
      value.every((item: unknown) => typeof item === "string")
    )
      inputs[input.id] = value;
    else if (
      input.type !== "number" &&
      input.type !== "bool" &&
      input.type !== "list<text>" &&
      typeof value === "string"
    )
      inputs[input.id] = value;
    else return { ok: false, reason: `Input "${input.id}" has an invalid default.` };
  }
  return { ok: true, inputs };
}

export function checkEnable(i: {
  manifest: FlowManifest;
  files: Record<string, string>;
  index: number;
  projectDir: string;
  granted?: GrantedFolders;
  flowExists: (id: string) => boolean;
  selfId: string;
}): Result {
  const trigger = i.manifest.triggers.at(i.index);
  if (!Number.isInteger(i.index) || i.index < 0 || !trigger)
    return { ok: false, reason: "There is no such trigger." };
  if (trigger.kind === "manual") return { ok: false, reason: "Run by hand. There is nothing to switch." };
  if (trigger.kind === "new_item" || trigger.kind === "link" || trigger.kind === "webhook")
    return { ok: false, reason: "Not available yet." };
  const issue = validateManifest(i.manifest, { files: new Set(Object.keys(i.files)) }).find(
    (entry) => entry.severity === "error",
  );
  if (issue)
    return { ok: false, reason: `This flow cannot run unattended: ${issue.message} at ${issue.path}` };
  const defaults = inputsFromDefaults(i.manifest);
  if (!defaults.ok) return defaults;
  if (trigger.kind === "schedule") {
    const everyMs = scheduleOf(trigger).everyMs;
    if (
      trigger.every !== undefined &&
      (everyMs === undefined || !Number.isFinite(everyMs) || everyMs < MIN_EVERY_MS)
    )
      return { ok: false, reason: "The shortest schedule is every 1 minute." };
    if (trigger.days?.length === 0) return { ok: false, reason: "No days are selected." };
  } else if (trigger.kind === "file_change") {
    if (
      !trigger.path ||
      trigger.path.includes("\0") ||
      trigger.glob.length > 200 ||
      (trigger.glob.match(/\*\*/g)?.length ?? 0) > 8
    )
      return { ok: false, reason: "That file pattern is too long or too complex." };
    const root = resolveRoot(i.projectDir, trigger.path, i.granted);
    if (!root.ok) return root;
  } else if (trigger.kind === "flow_done") {
    if (trigger.flow === i.selfId) return { ok: false, reason: "A flow cannot start itself." };
    if (!i.flowExists(trigger.flow))
      return { ok: false, reason: `The flow "${trigger.flow}" is not on this Mac.` };
  } else return { ok: false, reason: "Not available yet." };
  return { ok: true };
}

export function preflight(i: {
  enabled: boolean;
  hashOk: boolean;
  r4Errors: string[];
  runsToday: number;
  cap: number;
  open: number;
  queued: number;
  overlap: "skip" | "queue";
}): { ok: true } | { ok: false; outcome: TriggerOutcome; consume: boolean; detail: string } {
  if (!i.enabled || !i.hashOk)
    return { ok: false, outcome: "needs_ok", consume: false, detail: "Needs your OK again." };
  if (i.r4Errors.length)
    return {
      ok: false,
      outcome: "refused",
      consume: true,
      detail: Array.from(i.r4Errors[0] ?? "")
        .slice(0, 200)
        .join(""),
    };
  if (
    ![i.runsToday, i.cap, i.open, i.queued].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    i.cap === 0 ||
    (i.overlap !== "skip" && i.overlap !== "queue")
  )
    return { ok: false, outcome: "refused", consume: false, detail: "Invalid trigger preflight." };
  if (i.runsToday >= i.cap)
    return { ok: false, outcome: "dropped_cap", consume: true, detail: "Daily run limit reached." };
  if (i.open > 0 && i.overlap === "skip")
    return { ok: false, outcome: "skipped_overlap", consume: true, detail: "A run is already open." };
  if (i.open > 0 && i.queued >= MAX_QUEUED_TRIGGERED)
    return { ok: false, outcome: "dropped_queue_full", consume: false, detail: "The run queue is full." };
  return { ok: true };
}

export function sanitizeText(text: string, max: number): string {
  if (!Number.isSafeInteger(max) || max <= 0) return "";
  const clean = text
    .replace(/\p{White_Space}/gu, " ")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/ +/g, " ")
    .trim();
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  if (max < 3) return "";
  return `${chars.slice(0, max - 3).join("")}...`;
}
export function payloadFiles(paths: string[], max: number): string[] {
  if (!Number.isSafeInteger(max) || max < 0) return [];
  return paths
    .slice(0, max)
    .map((path) => sanitizeText(path, 200))
    .filter(Boolean);
}
export function triggerWords(
  kind: string,
  payload: Value | undefined,
  flowNameOf: (id: string) => string | undefined,
): string | undefined {
  const data =
    payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : undefined;
  if (kind === "schedule") {
    const missed = data?.missed;
    return typeof missed === "number" && Number.isSafeInteger(missed) && missed > 0
      ? `Started by its schedule, catching up on ${missed} missed`
      : "Started by its schedule";
  }
  if (kind === "file_change") return "Started by a change in the watched folder";
  if (kind === "flow_done" && typeof data?.flow === "string" && data.flow.length > 0) {
    const name = sanitizeText(flowNameOf(data.flow) ?? data.flow, 60);
    return name ? `Started after ${name}` : undefined;
  }
  return undefined;
}
