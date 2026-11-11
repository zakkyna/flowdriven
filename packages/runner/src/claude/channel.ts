import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ControlDir } from "./control.ts";
import type { Decision } from "./decide.ts";
export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export const CHANNEL = {
  unreadable: "FlowDriven could not read this request.",
  tooLarge: "This request is too large.",
  reused: "This tool call was already seen.",
  checkFailed: "FlowDriven could not check this call.",
};
export type CallRecord = { decision: Decision; toolUseId?: string };
export type Channel = {
  stop(): void;
  allowedIds: ReadonlySet<string>;
  counts(): { allowed: number; denied: number };
  started(): boolean;
};
export function startChannel(options: {
  dir: ControlDir;
  decide: (call: unknown) => Decision;
  onCall?: (record: CallRecord) => void;
  pollMs?: number;
}): Channel {
  const { dir } = options;
  const ids = new Set<string>();
  const names = new Set<string>();
  const allowedIds = new Set<string>();
  let allowed = 0;
  let denied = 0;
  let stopped = false;
  function record(decision: Decision, toolUseId?: string) {
    if (decision.allow) {
      allowed++;
      if (toolUseId !== undefined) allowedIds.add(toolUseId);
    } else denied++;
    try {
      options.onCall?.({ decision, ...(toolUseId === undefined ? {} : { toolUseId }) });
    } catch {}
  }
  const deny = (reason: string): Decision => ({ allow: false, tool: "unknown", reason });
  function poll() {
    if (stopped) return;
    let entries: string[];
    try {
      entries = readdirSync(dir.req).sort();
    } catch {
      return;
    }
    for (const file of entries) {
      if (stopped) return;
      if (file.startsWith(".")) continue;
      const path = join(dir.req, file);
      if (!/^[A-Za-z0-9]{16}\.json$/.test(file)) {
        try {
          rmSync(path, { recursive: true, force: true });
          record(deny(CHANNEL.unreadable));
        } catch {}
        continue;
      }
      const name = file.slice(0, -5);
      let decision: Decision;
      let id: string | undefined;
      try {
        const stat = lstatSync(path);
        if (names.has(name) || !stat.isFile()) decision = deny(CHANNEL.unreadable);
        else if (stat.size > MAX_REQUEST_BYTES) decision = deny(CHANNEL.tooLarge);
        else {
          let call: unknown;
          let valid = true;
          try {
            call = JSON.parse(readFileSync(path, "utf8")) as unknown;
          } catch {
            valid = false;
          }
          if (!valid) decision = deny(CHANNEL.unreadable);
          else {
            if (
              call !== null &&
              typeof call === "object" &&
              !Array.isArray(call) &&
              typeof (call as Record<string, unknown>).tool_use_id === "string"
            )
              id = (call as { tool_use_id: string }).tool_use_id;
            if (id !== undefined && ids.has(id)) decision = deny(CHANNEL.reused);
            else {
              if (id !== undefined) ids.add(id);
              try {
                decision = options.decide(call);
              } catch {
                decision = deny(CHANNEL.checkFailed);
              }
            }
          }
        }
        names.add(name);
        record(decision, id);
        const answer = decision.allow
          ? "allow\n"
          : `deny\n${decision.reason.replace(/[\r\n]/g, " ").slice(0, 300)}\n`;
        const tmp = join(dir.res, `.${name}.tmp`);
        writeFileSync(tmp, answer, { mode: 0o600 });
        renameSync(tmp, join(dir.res, name));
        rmSync(path, { recursive: true, force: true });
      } catch {
        /* A missing or unreadable file must never produce an allow. */
      }
    }
  }
  const timer = setInterval(poll, options.pollMs ?? 25);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    allowedIds,
    counts: () => ({ allowed, denied }),
    started: () => existsSync(dir.started),
  };
}
