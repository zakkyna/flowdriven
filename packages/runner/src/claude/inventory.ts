import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type ConnectorFact, readConnectors } from "./connector-scan.ts";
import { childEnv } from "./env.ts";
import { runCapture } from "./run-capture.ts";
import { visible } from "./text.ts";
export type InventoryEntry = {
  name: string;
  scope: "user" | "project";
  source?: string;
  connection?: "connected" | "needs_login" | "failed";
};
export type Inventory = {
  skills: InventoryEntry[];
  plugins: InventoryEntry[];
  mcpServers?: InventoryEntry[];
  connectors?: ConnectorFact[];
};
export function listSkills(options: { home?: string; project?: string }): InventoryEntry[] {
  const entries: InventoryEntry[] = [];
  for (const [root, scope] of [
    [options.home, "user"],
    [options.project, "project"],
  ] as const) {
    if (!root) continue;
    const dir = join(root, ".claude/skills");
    try {
      for (const name of readdirSync(dir)) {
        try {
          if (statSync(join(dir, name)).isDirectory() && statSync(join(dir, name, "SKILL.md")).isFile())
            entries.push({ name: visible(name, 120), scope });
        } catch {
          /* Ignore missing or inaccessible entries. */
        }
      }
    } catch {
      /* Ignore missing or inaccessible folders. */
    }
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, 200);
}
export function parsePlugins(stdout: string): InventoryEntry[] {
  try {
    const data: unknown = JSON.parse(stdout);
    if (!Array.isArray(data)) return [];
    const entries: InventoryEntry[] = [];
    for (const item of data as unknown[]) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        if (typeof obj.id === "string" && obj.enabled === true)
          entries.push({ name: visible(obj.id, 120), scope: obj.scope === "project" ? "project" : "user" });
      }
      if (entries.length === 200) break;
    }
    return entries;
  } catch {
    return [];
  }
}
export function parseMcp(stdout: string): InventoryEntry[] {
  const entries: InventoryEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim() || line.startsWith("Checking MCP server health")) continue;
    const first = line.indexOf(": ");
    const last = line.lastIndexOf(" - ");
    if (first <= 0 || last <= first + 1) continue;
    const name = line.slice(0, first);
    const state = line
      .slice(last + 3)
      .replace(/[^a-zA-Z ]/g, "")
      .trim();
    const entry: InventoryEntry = {
      name: visible(name, 120),
      scope: "user",
      source: name.startsWith("claude.ai ") ? "claude.ai" : name.startsWith("plugin:") ? "plugin" : "config",
    };
    if (state === "Connected") entry.connection = "connected";
    else if (state === "Needs authentication") entry.connection = "needs_login";
    else if (state === "Failed to connect") entry.connection = "failed";
    entries.push(entry);
    if (entries.length === 200) break;
  }
  return entries;
}
export async function readInventory(options: {
  claude: string;
  cwd: string;
  env: Record<string, string | undefined>;
  project?: string;
  withMcp: boolean;
  timeoutMs?: number;
  mcpTimeoutMs?: number;
}): Promise<Inventory> {
  const capture = async (args: string[], timeoutMs: number): Promise<string | undefined> => {
    try {
      const result = await runCapture(options.claude, args, {
        env: childEnv(options.env),
        cwd: options.cwd,
        timeoutMs,
        maxBytes: 262_144,
      });
      return result.code === 0 && !result.timedOut && !result.truncated ? result.stdout : undefined;
    } catch {
      return undefined;
    }
  };
  const [plugins, mcp, connectors] = await Promise.all([
    capture(["plugin", "list", "--json"], options.timeoutMs ?? 10_000),
    options.withMcp ? capture(["mcp", "list"], options.mcpTimeoutMs ?? 30_000) : Promise.resolve(undefined),
    options.withMcp
      ? readConnectors({
          claude: options.claude,
          cwd: options.cwd,
          env: options.env,
          waitMs: Math.min(options.mcpTimeoutMs ?? 20_000, 20_000),
        })
      : Promise.resolve(undefined),
  ]);
  const result: Inventory = {
    skills: listSkills({ home: options.env.HOME, project: options.project }),
    plugins: parsePlugins(plugins ?? ""),
  };
  if (connectors !== undefined) result.connectors = connectors;
  if (mcp !== undefined) result.mcpServers = parseMcp(mcp);
  return result;
}
