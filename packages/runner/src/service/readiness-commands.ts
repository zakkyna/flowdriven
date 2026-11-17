import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Requirement } from "@flowdriven/sdk";
import { visible } from "../claude/text.ts";

export function findProgram(
  name: string,
  path: string,
  isExecutable: (file: string) => boolean,
): string | undefined {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") return undefined;
  for (const folder of path.split(delimiter)) {
    if (!folder) continue;
    const file = join(folder, name);
    if (isExecutable(file)) return file;
  }
  return undefined;
}

function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function commandReadiness(
  req: Requirement,
  o: { path: string },
): { state: "ok" | "missing"; detail: string } {
  const programs =
    req.type === "cli_tool"
      ? [...new Set((req.commands ?? []).map((command) => command.split(" ")[0] ?? ""))]
      : [];
  let found: { program: string; file: string } | undefined;
  for (const program of programs) {
    const file = findProgram(program, o.path, isExecutable);
    if (!file) return { state: "missing", detail: `${visible(program, 100)} is not on this Mac's PATH.` };
    found ??= { program, file };
  }
  return found
    ? { state: "ok", detail: `Found ${visible(found.program, 100)} at ${visible(found.file, 300)}.` }
    : { state: "missing", detail: "No command is declared." };
}
