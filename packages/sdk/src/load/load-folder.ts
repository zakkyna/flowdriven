import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FlowManifest } from "../format/manifest.ts";
import { parseManifest } from "../format/parse.ts";
import type { Schedule } from "../format/schedule.ts";
import { contentHash, FlowFileError, type FlowFiles } from "../hash/canonical.ts";
import type { Issue } from "../issues.ts";
import { validateManifest } from "../validate/validate.ts";
import { parseFlowYaml } from "./parse-yaml.ts";

export type LoadedFlow = {
  manifest: FlowManifest;
  files: FlowFiles;
  hash: string;
  issues: Issue[];
  suggestedSchedule?: Schedule;
};
export function loadFlowFolder(dir: string): LoadedFlow {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  function walk(path: string, prefix: string): void {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new FlowFileError("symlink", `Symbolic link: ${prefix}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) {
        if (name === ".git" || name === "node_modules" || name === ".DS_Store") continue;
        walk(join(path, name), prefix ? `${prefix}/${name}` : name);
      }
    } else if (stat.isFile()) {
      if (files.size >= 2000) throw new FlowFileError("too_large", "Too many files in flow folder");
      if (stat.size > 2_097_152 || total + stat.size > 10_485_760)
        throw new FlowFileError("too_large", `Flow folder is too large: ${prefix}`);
      const bytes = readFileSync(path);
      total += bytes.length;
      if (bytes.length > 2_097_152 || total > 10_485_760)
        throw new FlowFileError("too_large", `Flow folder is too large: ${prefix}`);
      files.set(prefix, bytes);
    } else throw new FlowFileError("invalid_path", `Unsupported folder entry: ${prefix}`);
  }
  walk(dir, "");
  const yaml = files.get("flow.yaml");
  if (!yaml || !files.has("README.md"))
    throw new FlowFileError("missing_file", "flow.yaml and README.md are required");
  const hash = contentHash(files);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(yaml);
  } catch (error) {
    throw new FlowFileError("yaml", error instanceof Error ? error.message : String(error));
  }
  const parsed = parseManifest(parseFlowYaml(text));
  if (!parsed.ok)
    return {
      get manifest(): FlowManifest {
        throw new Error("Flow manifest is invalid");
      },
      files,
      hash,
      issues: parsed.issues,
    };
  return {
    manifest: parsed.manifest,
    ...(parsed.manifest.format === "flowdriven-flow/1.2" && parsed.manifest.schedule
      ? { suggestedSchedule: parsed.manifest.schedule }
      : {}),
    files,
    hash,
    issues: validateManifest(parsed.manifest, { files: new Set(files.keys()) }),
  };
}
