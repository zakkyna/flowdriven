import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Requirement } from "@flowdriven/sdk";
import { hasParentPart, isInside, resolveDeep } from "./paths.ts";
import { visible } from "./text.ts";

export type Folder = { path: string; write: boolean };
export type Policy = {
  tools: string[];
  folders: Folder[];
  cwd: string;
  addDirs: string[];
  schema: boolean;
  sessionId: string;
};

export function isProjectRef(ref: string | undefined): boolean {
  if (ref === undefined || ref === ".") return true;
  if (!ref || ref.startsWith("/") || ref.startsWith("\\") || ref.startsWith("~") || hasParentPart(ref))
    return false;
  for (const char of ref) {
    const point = char.codePointAt(0);
    if (point === undefined || point < 0x20 || point === 0x7f) return false;
  }
  return true;
}

export function buildPolicy(input: {
  kind: "worker" | "agent";
  requirements: Requirement[];
  project: string;
  controlRoot: string;
  controlCwd: string;
  sessionId: string;
  schema: boolean;
}): Policy {
  const policy: Policy = {
    tools: [],
    folders: [],
    cwd: input.controlCwd,
    addDirs: [],
    schema: input.schema,
    sessionId: input.sessionId,
  };
  if (input.kind === "agent") return policy;
  const paths = input.requirements.filter((requirement) => {
    if (requirement.type === "path") return true;
    if (requirement.type === "harness") return false;
    throw new Error(`This step uses something FlowDriven cannot enforce yet (${requirement.id}).`);
  });
  if (paths.length === 0) return policy;
  const control = resolveDeep(input.controlRoot);
  const pending: { path: string; ref: string | undefined; write: boolean }[] = [];
  for (const requirement of paths) {
    if (requirement.type !== "path") continue;
    if (requirement.access !== "read" && requirement.access !== "read_write") {
      throw new Error(`This step uses something FlowDriven cannot enforce yet (${requirement.id}).`);
    }
    const ref = requirement.ref;
    const failure = () => new Error(`The folder ${visible(ref ?? ".", 60)} is not inside the project.`);
    if (!isProjectRef(ref)) throw failure();
    let project: string;
    try {
      project = realpathSync.native(input.project);
    } catch {
      throw failure();
    }
    const folder = resolveDeep(ref === undefined || ref === "." ? input.project : join(input.project, ref));
    if (folder === undefined || !isInside(project, folder)) throw failure();
    if (control === undefined || isInside(folder, control) || isInside(control, folder))
      throw new Error("A folder of this step overlaps FlowDriven's control folder.");
    pending.push({ path: folder, ref, write: requirement.access === "read_write" });
  }
  for (const entry of pending) {
    const failure = () => new Error(`The folder ${visible(entry.ref ?? ".", 60)} is not inside the project.`);
    let folder: string;
    try {
      mkdirSync(entry.path, { recursive: true });
      folder = realpathSync.native(entry.path);
      const project = realpathSync.native(input.project);
      if (!isInside(project, folder)) throw failure();
      const resolvedControl = resolveDeep(input.controlRoot);
      if (
        resolvedControl === undefined ||
        isInside(folder, resolvedControl) ||
        isInside(resolvedControl, folder)
      )
        throw new Error("A folder of this step overlaps FlowDriven's control folder.");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "A folder of this step overlaps FlowDriven's control folder."
      )
        throw error;
      throw failure();
    }
    const existing = policy.folders.find((item) => item.path === folder);
    if (existing) existing.write ||= entry.write;
    else policy.folders.push({ path: folder, write: entry.write });
  }
  const first = policy.folders.at(0);
  if (first) {
    policy.cwd = first.path;
    policy.addDirs = policy.folders.slice(1).map((folder) => folder.path);
    policy.tools = ["Read", "Glob", "Grep"];
    if (policy.folders.some((folder) => folder.write)) policy.tools.push("Write", "Edit");
  }
  return policy;
}
