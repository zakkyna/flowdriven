import { runCapture } from "../claude/run-capture.ts";
import type { Probes } from "./types.ts";

export type Capture = (command: string, args: string[]) => Promise<{ code: number | null; stdout: string }>;

export function parsePressure(stdout: string): number | undefined {
  const text = stdout.trim();
  if (!/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function parsePs(stdout: string, pgid: number): number | undefined {
  if (!Number.isSafeInteger(pgid) || pgid <= 0) return undefined;
  let sum = 0;
  let found = false;
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) {
      const first = line.trim().split(/\s+/).at(0);
      if (first && /^\d+$/.test(first) && Number(first) === pgid) return undefined;
      continue;
    }
    if (Number(match[1]) !== pgid) continue;
    const rss = Number(match[2]);
    if (!Number.isSafeInteger(rss) || !Number.isSafeInteger(sum + rss)) return undefined;
    sum += rss;
    found = true;
  }
  return found ? sum / 1024 : undefined;
}

export function reserveMb(setting: number | null, totalMb: number): number {
  return setting ?? Math.max(1024, Math.round(totalMb * 0.15));
}

export const realCapture: Capture = async (command, args) => {
  try {
    const result = await runCapture(command, args, {
      env: { PATH: "/usr/bin:/bin:/usr/sbin" },
      timeoutMs: 3000,
      maxBytes: 1_000_000,
    });
    if (result.timedOut || result.truncated) return { code: null, stdout: "" };
    return { code: result.code, stdout: result.stdout };
  } catch {
    return { code: null, stdout: "" };
  }
};

export function createProbes(o: {
  capture: Capture;
  platform: NodeJS.Platform;
  availableMemory: () => number;
  totalMemory: () => number;
}): Probes {
  let available: number | undefined;
  let pressure: number | undefined;
  let ps: string | undefined;
  return {
    async refresh() {
      available = undefined;
      pressure = undefined;
      ps = undefined;
      try {
        const bytes = o.availableMemory();
        if (Number.isFinite(bytes) && bytes >= 0) available = bytes / 1048576;
      } catch {
        // A missing sample stays unknown.
      }
      if (o.platform !== "darwin") return;
      try {
        const result = await o.capture("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]);
        if (result.code === 0) pressure = parsePressure(result.stdout);
      } catch {
        // A failed probe stays unknown.
      }
      try {
        const result = await o.capture("/bin/ps", ["-axo", "pgid=,rss="]);
        if (result.code === 0) ps = result.stdout;
      } catch {
        // A failed probe stays unknown.
      }
    },
    availableMb: () => available,
    pressureLevel: () => pressure,
    groupRssMb: (pid) => (ps === undefined ? undefined : parsePs(ps, pid)),
    totalMb() {
      try {
        const bytes = o.totalMemory();
        return Number.isFinite(bytes) && bytes >= 0 ? bytes / 1048576 : 0;
      } catch {
        return 0;
      }
    },
  };
}
