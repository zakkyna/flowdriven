import { domainToASCII } from "node:url";
import type { Requirement, Value } from "@flowdriven/sdk";
import { visible } from "../claude/text.ts";
import { catalogEntry } from "../connectors/catalog.ts";
import { isCallGrant } from "../connectors/grants.ts";
import type { Store } from "../storage.ts";

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
      const to = list(input.to);
      const cc = input.cc === undefined ? undefined : list(input.cc);
      const bcc = input.bcc === undefined ? undefined : list(input.bcc);
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

export function approvedCallsOf(
  store: Pick<Store, "listApprovals" | "findGrant">,
  runId: string,
  stepId: string,
  itemKey: string,
): { tool: string; input: Value }[] {
  return store.listApprovals({ runId, state: "approved" }).flatMap((row) => {
    const grant = row.approves.at(0);
    if (
      row.kind !== "risky_action" ||
      row.stepId !== stepId ||
      row.itemKey !== itemKey ||
      !row.call ||
      !grant ||
      !isCallGrant(grant) ||
      !store.findGrant({
        runId,
        stepId,
        itemKey,
        tool: row.call.tool.startsWith("mcp__") ? row.call.tool : grant.slice(0, grant.indexOf("#")),
        digest: grant.slice(grant.indexOf("#") + 1),
        kind: "approve",
        createdAt: "",
      })
    )
      return [];
    const tool = row.call.tool.startsWith("mcp__")
      ? row.call.tool.slice(row.call.tool.lastIndexOf("__") + 2)
      : row.call.tool;
    return [{ ...row.call, tool }];
  });
}
export function labelOf(requirements: Requirement[], requirementId: string): string {
  return (
    catalogEntry(requirements.find((requirement) => requirement.id === requirementId)?.ref)?.label ??
    "a connector"
  );
}
