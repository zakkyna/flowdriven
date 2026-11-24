import { domainToASCII } from "node:url";
import {
  type FlowManifest,
  type LeafStep,
  type LoopStep,
  parseExpression,
  type Requirement,
  references,
  templateExpressions,
  unattendedRisk,
  type Value,
} from "@flowdriven/sdk";
import { visible } from "../claude/text.ts";
import { catalogEntry } from "../connectors/catalog.ts";
import { isCallGrant } from "../connectors/grants.ts";
import { effectOf } from "../rules/effects.ts";
import type { StepRow, Store } from "../storage.ts";

export const MAX_HOLDS = 3;
export const MAX_HELD_CHARS = 4000;
export const HOLD_TEXT = {
  tooMany: "This step asked for approval too many times.",
  tooLarge: "FlowDriven could not show the whole text, so it did not ask.",
};
export function asciiAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return address.toLowerCase();
  const domain = domainToASCII(address.slice(at + 1).toLowerCase());
  return domain ? `${address.slice(0, at).toLowerCase()}@${domain}` : address.toLowerCase();
}
function markHeld(text: string): string {
  return text
    .split("\n")
    .map((line) => visible(line, Infinity).replace(/<U\+([0-9A-F]+)>/g, "[U+$1 hidden character]"))
    .join("\n");
}
function addresses(value: Value | undefined): string[] | undefined {
  const items = typeof value === "string" ? [value] : value;
  if (!Array.isArray(items) || !items.every((v) => typeof v === "string")) return undefined;
  const result: string[] = [];
  for (const item of items as string[]) {
    let start = 0;
    let quoted = false;
    let escaped = false;
    let angle = false;
    let comments = 0;
    const parts: string[] = [];
    for (let i = 0; i < item.length; i++) {
      const char = item[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\" && (quoted || comments > 0)) {
        escaped = true;
        continue;
      }
      if (char === '"' && comments === 0) quoted = !quoted;
      else if (!quoted && char === "(") comments++;
      else if (!quoted && char === ")") {
        if (!comments) return undefined;
        comments--;
      } else if (!quoted && !comments && char === "<") {
        if (angle) return undefined;
        angle = true;
      } else if (!quoted && !comments && char === ">") {
        if (!angle) return undefined;
        angle = false;
      } else if (!quoted && !comments && !angle && char === ",") {
        parts.push(item.slice(start, i));
        start = i + 1;
      }
    }
    if (quoted || escaped || angle || comments) return undefined;
    parts.push(item.slice(start));
    for (const part of parts) {
      const display = part.trim();
      const match = display.match(/<([^<>]+)>\s*$/);
      const address = (match ? match[1] : display)?.trim();
      if (!address) return undefined;
      const at = address.lastIndexOf("@");
      if (at < 1 || at === address.length - 1) return undefined;
      const domain = domainToASCII(
        address
          .slice(at + 1)
          .trim()
          .toLowerCase(),
      );
      if (!domain) return undefined;
      const ascii = `${address.slice(0, at).toLowerCase()}@${domain}`;
      result.push(markHeld(display) + (ascii !== address.toLowerCase() ? ` (${markHeld(ascii)})` : ""));
    }
  }
  return result;
}

export function hasHiddenRecipients(tool: string | undefined, input: unknown): boolean {
  if (!tool || !input || typeof input !== "object" || Array.isArray(input)) return false;
  const record = input as Record<string, Value>;
  if (/(?:^|__|\.)send_message$/.test(tool)) return Object.hasOwn(record, "draftId");
  if (/(?:^|__|\.)reply$/.test(tool)) {
    if (record.replyAll === true) return true;
    const to = addresses(record.to);
    return !to || to.length === 0;
  }
  return false;
}

export function heldPayload(input: Value, tool?: string): Value | undefined {
  if (hasHiddenRecipients(tool, input)) return undefined;
  if (
    tool &&
    /(?:^|__)(?:reply|send_message)$/.test(tool) &&
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    const keys = Object.keys(input);
    const allowed = ["to", "cc", "bcc", "subject", "body", "attachments"];
    if (
      keys.every((key) => allowed.includes(key)) &&
      input.to !== undefined &&
      typeof input.subject === "string" &&
      typeof input.body === "string"
    ) {
      const list = (value: Value | undefined) =>
        typeof value === "string"
          ? [markHeld(value)]
          : Array.isArray(value) && value.every((v) => typeof v === "string")
            ? value.map((v) => markHeld(v as string))
            : undefined;
      const to = addresses(input.to);
      const cc = input.cc === undefined ? undefined : addresses(input.cc);
      const bcc = input.bcc === undefined ? undefined : addresses(input.bcc);
      const attachments = input.attachments === undefined ? undefined : list(input.attachments);
      const subject = typeof input.subject === "string" ? markHeld(input.subject) : undefined;
      const body = typeof input.body === "string" ? markHeld(input.body) : undefined;
      const validList = (value: string[]) =>
        value.length <= 50 && value.every((item) => item.length <= MAX_HELD_CHARS);
      if (
        !to ||
        to.length === 0 ||
        !validList(to) ||
        (input.cc !== undefined && (!cc || !validList(cc))) ||
        (input.bcc !== undefined && (!bcc || !validList(bcc))) ||
        (input.attachments !== undefined && (!attachments || !validList(attachments))) ||
        subject === undefined ||
        subject.length > MAX_HELD_CHARS ||
        body === undefined ||
        body.length > MAX_HELD_CHARS
      )
        return undefined;
      return {
        kind: "email",
        to,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        ...(attachments ? { attachments } : {}),
        subject,
        body,
      };
    }
  }
  const recipientValues =
    input && typeof input === "object" && !Array.isArray(input)
      ? ["to", "cc", "bcc", "recipient", "recipients"].flatMap((key) =>
          input[key] === undefined ? [] : [input[key]],
        )
      : [];
  const converted = recipientValues.map((value) => addresses(value));
  if (converted.some((items) => items === undefined)) return undefined;
  const ascii = converted.flatMap((items) => items ?? []).filter((item) => item.includes(" ("));
  const text =
    JSON.stringify(input, null, 2)
      .split("\n")
      .map((line) => markHeld(line))
      .join("\n") + ascii.map((address) => `\n${address}`).join("");
  return text.length <= MAX_HELD_CHARS ? text : undefined;
}

export function sendCapable(store: Store, row: StepRow, manifest: FlowManifest): boolean {
  if (store.hasCallGrant(row.runId, row.stepId, row.itemKey)) return true;
  if (
    store
      .listApprovals({ runId: row.runId })
      .some(
        (decision) =>
          (decision.kind === "risky_action" || decision.kind === "outside_flow") &&
          decision.stepId === row.stepId &&
          decision.itemKey === row.itemKey &&
          ["approved", "approved_edited", "allowed_always"].includes(decision.state),
      )
  )
    return true;
  const steps = manifest.steps.flatMap((step) => ("for_each" in step ? step.steps : [step]));
  const step = steps.find((entry) => entry.id === row.stepId);
  if (!step) return false;
  if (unattendedRisk(step, manifest)) return true;
  return manifest.requirements.some((req) => {
    if (!step.uses.includes(req.id) || req.type !== "mcp_server") return false;
    const entry = catalogEntry(req.ref);
    return (req.tools ?? []).some(
      (tool) =>
        entry?.labelTools?.includes(tool) ||
        ["send", "post", "pay", "delete", "merge"].includes(
          effectOf(entry ? entry.prefix + tool : `${req.id}.${tool}`).effect,
        ),
    );
  });
}

export function approvedCallsOf(
  store: Pick<Store, "listApprovals" | "findGrant">,
  runId: string,
  stepId: string,
  itemKey: string,
): { tool: string; input: Value; outsideFlow?: true }[] {
  return store
    .listApprovals({ runId })
    .filter(
      (row) => row.state === "approved" || row.state === "approved_edited" || row.state === "allowed_always",
    )
    .flatMap((row): { tool: string; input: Value; outsideFlow?: true }[] => {
      const grant = row.approves.at(0);
      if (
        (row.kind !== "risky_action" && row.kind !== "outside_flow") ||
        row.stepId !== stepId ||
        row.itemKey !== itemKey ||
        !row.call ||
        !grant ||
        !isCallGrant(grant) ||
        !store.findGrant({
          runId,
          stepId,
          itemKey,
          tool:
            row.kind === "outside_flow" || row.call.tool.startsWith("mcp__")
              ? row.call.tool
              : grant.slice(0, grant.indexOf("#")),
          digest: row.editedDigest ?? grant.slice(grant.indexOf("#") + 1),
          kind: "approve",
          createdAt: "",
        })
      )
        return [];
      const tool =
        row.kind !== "outside_flow" && row.call.tool.startsWith("mcp__")
          ? row.call.tool.slice(row.call.tool.lastIndexOf("__") + 2)
          : row.call.tool;
      const input = row.call.input;
      if (
        row.state === "approved_edited" &&
        row.editedText !== undefined &&
        input &&
        typeof input === "object" &&
        !Array.isArray(input)
      ) {
        const key = typeof input.body === "string" ? "body" : "text";
        return [
          {
            tool,
            input: {
              ...input,
              [key]: row.editedText,
              ...(row.editedSubject === undefined ? {} : { subject: row.editedSubject }),
            },
          },
        ];
      }
      return [{ ...row.call, tool, ...(row.kind === "outside_flow" ? { outsideFlow: true as const } : {}) }];
    });
}
export function rejectedCallsOf(
  store: Pick<Store, "listApprovals">,
  runId: string,
  stepId: string,
  itemKey: string,
): { tool: string; digest: string }[] {
  return store.listApprovals({ runId }).flatMap((row) => {
    const grant = row.approves[0];
    if (
      !((row.kind === "outside_flow" && row.state === "rejected") || row.state === "another_way") ||
      row.stepId !== stepId ||
      row.itemKey !== itemKey ||
      !row.call ||
      !grant?.includes("#")
    )
      return [];
    return [{ tool: row.call.tool, digest: grant.slice(grant.indexOf("#") + 1) }];
  });
}
export function anotherWayOf(
  store: Pick<Store, "listApprovals">,
  runId: string,
  stepId: string,
  itemKey: string,
  options?: { outsideOnly?: boolean },
): string | undefined {
  let newest: { at: string; text: string } | undefined;
  for (const row of store.listApprovals({ runId })) {
    if (
      row.state !== "another_way" ||
      row.stepId !== stepId ||
      row.itemKey !== itemKey ||
      row.anotherWayText === undefined ||
      (options?.outsideOnly && row.kind !== "outside_flow")
    )
      continue;
    const at = row.resolvedAt ?? "";
    if (!newest || at >= newest.at) newest = { at, text: row.anotherWayText };
  }
  return newest?.text;
}
export function labelOf(requirements: Requirement[], requirementId: string): string {
  return (
    catalogEntry(requirements.find((requirement) => requirement.id === requirementId)?.ref)?.label ??
    "a connector"
  );
}

export function skippedDependency(
  step: LeafStep | LoopStep,
  itemKey: string,
  rows: StepRow[],
): StepRow | undefined {
  const strings = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === "object") return Object.values(value).flatMap(strings);
    return [];
  };
  const texts =
    "for_each" in step
      ? [step.for_each]
      : [...("instructions" in step ? [step.instructions] : []), ...strings(step.checks)];
  const paths = texts.flatMap((text) =>
    templateExpressions(text).flatMap((source) => references(parseExpression(source))),
  );
  if (step.when) paths.push(...references(parseExpression(step.when)));
  return rows.find((entry) => {
    if (
      (entry.itemKey !== "" && entry.itemKey !== itemKey) ||
      entry.state !== "skipped" ||
      entry.skipped?.because === "no_picks"
    )
      return false;
    return paths.some((path) => {
      const rest =
        path[0] === "steps" && path[1] === entry.stepId
          ? path.slice(2)
          : path[0] === entry.stepId
            ? path.slice(1)
            : [];
      return rest.length > 0 && !["status", "passed", "failed", "skipped"].includes(rest[0] ?? "");
    });
  });
}
