import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
export type R12Mode = "kill" | "remove";
export type R12Report = {
  mode: R12Mode;
  startSeen: boolean;
  requestLeft: boolean;
  allowed: number;
  refused: number;
  fileExists: boolean;
  claudeAlive: boolean;
};
export function startSeen(controlDir: string): boolean {
  return existsSync(join(controlDir, "started"));
}
export function parsePs(text: string, needle: string): number[] {
  if (!needle) return [];
  return text.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    return match?.[1] && match[2]?.includes(needle) ? [Number(match[1])] : [];
  });
}
export function listRequests(controlDir: string): string[] {
  try {
    return readdirSync(join(controlDir, "req"), { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith(".") && e.name.endsWith(".json"))
      .map((e) => e.name);
  } catch {
    return [];
  }
}
export function firstControlDir(dataDir: string): string | undefined {
  const root = join(dataDir, "control");
  try {
    const first = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .at(0);
    return first === undefined ? undefined : join(root, first);
  } catch {
    return undefined;
  }
}
export function verdict(report: R12Report): { pass: boolean; lines: string[] } {
  const pass =
    report.startSeen &&
    !report.fileExists &&
    (report.mode === "kill"
      ? report.requestLeft
      : report.mode === "remove" && report.allowed === 0 && report.refused >= 1);
  const yes = (value: boolean) => (value ? "yes" : "no");
  return {
    pass,
    lines: [
      `start hook ran: ${yes(report.startSeen)}`,
      `request left unanswered: ${yes(report.requestLeft)}`,
      `calls the runner allowed: ${report.allowed}`,
      `calls Claude Code reports as refused: ${report.refused}`,
      `notes/hello.txt exists: ${yes(report.fileExists)}`,
      `claude process still alive: ${yes(report.claudeAlive)}`,
      `R12 (${report.mode}): ${pass ? "PASS" : "FAIL"}`,
    ],
  };
}
