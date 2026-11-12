import { spawn } from "node:child_process";
import { assertSafeArgs, buildConnectorScanArgs } from "./args.ts";
import { childEnv } from "./env.ts";
import { visible } from "./text.ts";

export type ConnectorFact = {
  name: string;
  url: string;
  id: string;
  status: "connected" | "needs_login" | "failed" | "pending";
  tools: { name: string; readOnly: boolean }[];
};
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export function parseConnectors(response: unknown): ConnectorFact[] {
  if (!object(response) || !Array.isArray(response.mcpServers)) return [];
  const facts: ConnectorFact[] = [];
  for (const s of response.mcpServers as unknown[]) {
    if (
      !object(s) ||
      s.scope !== "claudeai" ||
      !object(s.config) ||
      s.config.type !== "claudeai-proxy" ||
      typeof s.name !== "string" ||
      typeof s.config.id !== "string" ||
      !/^mcpsrv_[A-Za-z0-9]{1,60}$/.test(s.config.id) ||
      typeof s.config.url !== "string" ||
      s.config.url.length > 300
    )
      continue;
    const status =
      s.status === "connected"
        ? "connected"
        : s.status === "needs-auth"
          ? "needs_login"
          : s.status === "pending"
            ? "pending"
            : "failed";
    const tools: ConnectorFact["tools"] = [];
    if (status === "connected" && Array.isArray(s.tools))
      for (const t of s.tools as unknown[]) {
        if (!object(t) || typeof t.name !== "string" || !t.name || visible(t.name, 120) !== t.name) continue;
        tools.push({ name: t.name, readOnly: object(t.annotations) && t.annotations.readOnly === true });
        if (tools.length === 200) break;
      }
    facts.push({ name: visible(s.name, 120), url: s.config.url, id: s.config.id, status, tools });
    if (facts.length === 40) break;
  }
  return facts;
}
export async function readConnectors(options: {
  claude: string;
  cwd: string;
  env: Record<string, string | undefined>;
  waitMs?: number;
  pollMs?: number;
  names?: readonly string[];
}): Promise<ConnectorFact[] | undefined> {
  try {
    const args = buildConnectorScanArgs();
    assertSafeArgs(args);
    const child = spawn(options.claude, args, {
      cwd: options.cwd,
      env: childEnv(options.env),
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => {});
    child.stderr.resume();
    let last: ConnectorFact[] | undefined,
      buffer = "",
      sequence = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const wait = Math.max(0, options.waitMs ?? 20_000),
      started = Date.now();
    return await new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        if (timer !== undefined) clearTimeout(timer);
        child.stdin.end();
        if (child.pid !== undefined)
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
      };
      const deadline = setTimeout(done, wait);
      child.on("error", done);
      child.on("close", () => {
        done();
        resolve(last);
      });
      const request = () => {
        sequence++;
        child.stdin.write(
          `${JSON.stringify({ type: "control_request", request_id: `s${sequence}`, request: { subtype: "mcp_status" } })}\n`,
        );
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 2_000_000) {
          done();
          return;
        }
        let end = buffer.indexOf("\n");
        while (end !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const data: unknown = JSON.parse(line);
            if (
              object(data) &&
              data.type === "control_response" &&
              object(data.response) &&
              data.response.subtype === "success" &&
              data.response.request_id === `s${sequence}` &&
              object(data.response.response) &&
              Array.isArray(data.response.response.mcpServers)
            ) {
              last = parseConnectors(data.response.response);
              if (
                last.some(
                  (c) =>
                    c.status === "pending" && (options.names === undefined || options.names.includes(c.name)),
                ) &&
                Date.now() - started < wait
              )
                timer = setTimeout(
                  request,
                  Math.min(options.pollMs ?? 1000, Math.max(0, wait - (Date.now() - started))),
                );
              else done();
            }
          } catch {}
          end = buffer.indexOf("\n");
        }
      });
      child.stdin.write(
        `${JSON.stringify({ type: "control_request", request_id: "init", request: { subtype: "initialize", hooks: null } })}\n`,
      );
      request();
    });
  } catch {
    return undefined;
  }
}
