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
export function heldPayload(input: Value, tool?: string): Value | undefined {
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
      const addresses = (value: Value | undefined) => {
        const items = typeof value === "string" ? [value] : value;
        if (!Array.isArray(items) || !items.every((v) => typeof v === "string")) return undefined;
        return items.map((v: string) => {
          const ascii = asciiAddress(v);
          return markHeld(v) + (ascii !== v.toLowerCase() ? ` (${markHeld(ascii)})` : "");
        });
      };
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
  const addresses =
    input && typeof input === "object" && !Array.isArray(input)
      ? ["to", "cc", "bcc"].flatMap((key) => {
          const value = input[key];
          return typeof value === "string"
            ? [value]
            : Array.isArray(value)
              ? value.filter((v): v is string => typeof v === "string")
              : [];
        })
      : [];
  const ascii = addresses
    .map((address) => [address, asciiAddress(address)] as const)
    .filter(([address, converted]) => address.toLowerCase() !== converted);
  const text =
    JSON.stringify(input, null, 2)
      .split("\n")
      .map((line) => markHeld(line))
      .join("\n") +
    ascii
      .map(([address, converted]) => `\n${visible(address, Infinity)} (${visible(converted, Infinity)})`)
      .join("");
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
