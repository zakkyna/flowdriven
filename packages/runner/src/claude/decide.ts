import { isAbsolute } from "node:path";
import { hasParentPart, isInside, resolveDeep } from "./paths.ts";
import type { Policy } from "./policy.ts";
import { visible } from "./text.ts";

export type Decision =
  | { allow: true; tool: string; target?: string }
  | { allow: false; reason: string; tool: string; target?: string };

export const DENY = {
  badRequest: "This request is not a tool call FlowDriven recognises.",
  otherSession: "This request belongs to another session.",
  noSchema: "This step did not ask for structured output.",
  noPath: "This call has no file path.",
  pathNotText: "This call has a path that is not text.",
  notAbsolute: "This path is not absolute.",
  badPath: "This path is not allowed.",
  outside: "This path is outside the folders this step declares.",
  readOnly: "This step may only read this folder.",
  pattern: "This pattern leaves the folder.",
  protectedPath: "This path is protected.",
};

function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function protectedPath(path: string): boolean {
  const parts = path.split(/[\\/]/).map((part) =>
    [...part.normalize("NFKC").toUpperCase().toLowerCase().normalize("NFKC")]
      .filter((char) => {
        const point = char.codePointAt(0);
        return point !== undefined && point >= 0x21 && point <= 0x7e;
      })
      .join(""),
  );
  return parts.some((part) => part === ".git" || part === ".claude") || parts.at(-1) === ".mcp.json";
}

export function decide(policy: Policy, call: unknown): Decision {
  const tool = plain(call) && typeof call.tool_name === "string" ? visible(call.tool_name, 60) : "";
  const deny = (reason: string, target?: string): Decision => ({
    allow: false,
    reason,
    tool,
    ...(target === undefined ? {} : { target: target.slice(0, 300) }),
  });
  if (
    !plain(call) ||
    call.hook_event_name !== "PreToolUse" ||
    typeof call.tool_name !== "string" ||
    typeof call.tool_use_id !== "string" ||
    !plain(call.tool_input)
  )
    return deny(DENY.badRequest);
  if (call.session_id !== policy.sessionId) return deny(DENY.otherSession);
  if (call.tool_name === "StructuredOutput")
    return policy.schema ? { allow: true, tool } : deny(DENY.noSchema);
  if (!policy.tools.includes(call.tool_name)) return deny(`This step does not declare the tool ${tool}.`);
  const name = call.tool_name;
  if (!["Read", "Write", "Edit", "Glob", "Grep"].includes(name)) return deny(DENY.badRequest);
  const input = call.tool_input;
  const search = name === "Glob" || name === "Grep";
  const patternKey = name === "Glob" ? "pattern" : "glob";
  if (search && patternKey in input) {
    const pattern = input[patternKey];
    if (
      typeof pattern !== "string" ||
      pattern.includes("..") ||
      /[()]/.test(pattern) ||
      /\[[^\]]*\/[^\]]*\]/.test(pattern) ||
      pattern
        .split(/[{},]/)
        .some((part) => part.startsWith("/") || part.startsWith("\\") || part.startsWith("~"))
    )
      return deny(DENY.pattern);
  }
  const raw = search ? ("path" in input ? input.path : policy.cwd) : input.file_path;
  const target = search && !("path" in input) ? undefined : typeof raw === "string" ? raw : undefined;
  if (search && typeof raw !== "string") return deny(DENY.pathNotText);
  if (typeof raw !== "string" || (!search && raw === "")) return deny(DENY.noPath);
  if (!isAbsolute(raw)) return deny(DENY.notAbsolute, target);
  if (hasParentPart(raw)) return deny(DENY.badPath, target);
  const resolved = resolveDeep(raw);
  if (resolved === undefined) return deny(DENY.badPath, target);
  const containing = policy.folders.filter((folder) => isInside(folder.path, resolved));
  if (containing.length === 0) return deny(DENY.outside, target);
  const write = name === "Write" || name === "Edit";
  if (write && !containing.some((folder) => folder.write)) return deny(DENY.readOnly, target);
  if (write && (protectedPath(raw) || protectedPath(resolved))) return deny(DENY.protectedPath, target);
  return { allow: true, tool, ...(target === undefined ? {} : { target: target.slice(0, 300) }) };
}
