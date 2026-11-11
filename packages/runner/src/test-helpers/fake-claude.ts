#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Action = { do: string; [key: string]: unknown };
type Play = { when: string; startHook?: boolean; init?: false | Record<string, unknown>; actions: Action[] };
type Script = {
  version?: string;
  help?: string;
  auth?: { loggedIn: boolean; authMethod?: string } | { raw: string };
  plugins?: unknown[] | { raw: string };
  mcp?: string;
  hang?: string[];
  plays?: Play[];
};
type Hook = { command: string; timeout?: number };
const home = process.env.HOME;
if (!home) throw new Error("HOME is required");
const script = JSON.parse(readFileSync(join(home, "fake-claude.json"), "utf8")) as Script;
const args = process.argv.slice(2);
const logPath = join(home, "fake-claude.calls.jsonl");
const log = (value: unknown) => appendFileSync(logPath, `${JSON.stringify(value)}\n`);
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.at(i + 1);
};
const help =
  [
    "--output-format",
    "--verbose",
    "--no-session-persistence",
    "--session-id",
    "--model",
    "--restricted",
    "--strict-mcp-config",
    "--mcp-config",
    "--tools",
    "--disable-slash-commands",
    "--permission-prompts",
    "--settings",
    "--add-dir",
    "--json-schema",
  ].join("\n") + "\n";
const command = args.includes("-p")
  ? "play"
  : args[0] === "--version"
    ? "version"
    : args[0] === "--help"
      ? "help"
      : args[0] === "auth" && args[1] === "status" && args[2] === "--json"
        ? "auth"
        : args[0] === "plugin" && args[1] === "list" && args[2] === "--json"
          ? "plugins"
          : args[0] === "mcp" && args[1] === "list"
            ? "mcp"
            : "unknown";
let prompt: string | undefined;
if (command === "play") {
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  prompt = input;
}
log({
  kind: "call",
  pid: process.pid,
  args,
  cwd: process.cwd(),
  env: Object.keys(process.env)
    .filter((key) => key !== "__CF_USER_TEXT_ENCODING")
    .sort(),
  ...(prompt === undefined ? {} : { prompt }),
});
if (script.hang?.includes(command))
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
if (command === "version") process.stdout.write(`${script.version ?? "2.1.318"} (Claude Code)\n`);
else if (command === "help") process.stdout.write(script.help ?? help);
else if (command === "auth") {
  const auth = script.auth ?? {
    loggedIn: true,
    authMethod: "claude.ai",
    email: "a@example.test",
    orgId: "org-1",
    orgName: "Example",
  };
  process.stdout.write(`${"raw" in auth ? auth.raw : JSON.stringify(auth)}\n`);
} else if (command === "plugins") {
  const plugins = script.plugins ?? [
    { id: "design@market", enabled: true },
    { id: "old@market", enabled: false },
  ];
  process.stdout.write(`${!Array.isArray(plugins) ? plugins.raw : JSON.stringify(plugins)}\n`);
} else if (command === "mcp")
  process.stdout.write(
    script.mcp ??
      "Checking MCP server health...\n\nclaude.ai Gmail: https://mail.example.test/mcp (HTTP) - ! Needs authentication\n",
  );
else if (command === "play") {
  const settingsPath = arg("--settings");
  if (!settingsPath) throw new Error("Missing settings");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
    hooks: { SessionStart: { hooks: Hook[] }[]; PreToolUse: { hooks: Hook[] }[] };
  };
  const start = settings.hooks.SessionStart.at(0)?.hooks.at(0);
  const pre = settings.hooks.PreToolUse.at(0)?.hooks.at(0);
  if (!start || !pre) throw new Error("Missing hooks");
  const play = script.plays?.find((entry) => (prompt ?? "").includes(entry.when));
  if (!play) {
    process.stderr.write("fake-claude: no play for this prompt");
    process.exit(3);
  }
  async function hook(
    config: Hook,
    input: string,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return await new Promise((resolve, reject) => {
      const child = spawn("/bin/sh", ["-c", config.command], {
        env: { ...process.env },
        detached: true,
        stdio: "pipe",
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      const timer =
        config.timeout === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              if (child.pid) {
                try {
                  process.kill(-child.pid, "SIGKILL");
                } catch {}
              }
            }, config.timeout * 1000);
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code: timedOut ? null : code, stdout, stderr });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }
  if (play.startHook !== false) await hook(start, "{}");
  const session = arg("--session-id");
  if (play.init !== false) {
    const dirs = args.flatMap((value, index) =>
      value === "--add-dir" ? [args.at(index + 1)].filter((item): item is string => item !== undefined) : [],
    );
    const tools = (arg("--tools") ?? "").split(",").filter(Boolean);
    if (args.includes("--json-schema")) tools.push("StructuredOutput");
    emit({
      type: "system",
      subtype: "init",
      session_id: session,
      cwd: process.cwd(),
      tools,
      mcp_servers: [],
      permissionMode: "default",
      additional_directories: dirs,
      skills: args.includes("--disable-slash-commands") ? [] : ["fake-skill"],
      slash_commands: args.includes("--disable-slash-commands") ? [] : ["fake-command"],
      ...play.init,
    });
    log({ kind: "init" });
  }
  const denials: unknown[] = [];
  let lastText = "";
  const result = (
    isError: boolean,
    text: string,
    terminalReason: string,
    extra: Record<string, unknown> = {},
  ) =>
    emit({
      type: "result",
      subtype: "success",
      is_error: isError,
      result: text,
      permission_denials: denials,
      session_id: session,
      api_error_status: null,
      terminal_reason: terminalReason,
      ...extra,
    });
  for (const action of play.actions) {
    if (action.do === "text") {
      lastText = String(action.text);
      emit({ type: "assistant", message: { content: [{ type: "text", text: lastText }] } });
    } else if (action.do === "raw")
      process.stdout.write(String(action.line) + (action.newline === false ? "" : "\n"));
    else if (action.do === "pause") await new Promise((resolve) => setTimeout(resolve, Number(action.ms)));
    else if (action.do === "ignore_sigterm") process.on("SIGTERM", () => {});
    else if (action.do === "rate_limit")
      emit({ type: "rate_limit_event", rate_limit_info: { status: action.status } });
    else if (action.do === "exit") {
      if (action.stderr !== undefined) process.stderr.write(String(action.stderr));
      process.exitCode = Number(action.code);
      break;
    } else if (action.do === "auth_failure") {
      emit({
        type: "assistant",
        error: "authentication_failed",
        message: { content: [{ type: "text", text: "Not logged in - Please run /login" }] },
      });
      result(true, "Not logged in - Please run /login", "api_error");
      process.exit(1);
    } else if (action.do === "result") {
      result(action.isError === true, String(action.result ?? lastText), "completed", {
        ...(action.structured === undefined ? {} : { structured_output: action.structured }),
        api_error_status: action.apiErrorStatus ?? null,
      });
      process.exit(0);
    } else if (action.do === "tool" || action.do === "ungated") {
      const id = String(action.id);
      const name = String(action.name);
      const input = action.input ?? {};
      emit({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
      let ran = true;
      let content = String(action.result ?? "ok");
      if (action.do === "tool") {
        const reply = await hook(
          pre,
          JSON.stringify({
            session_id: session,
            transcript_path: "",
            cwd: process.cwd(),
            prompt_id: "fake-prompt",
            permission_mode: "default",
            effort: "low",
            hook_event_name: "PreToolUse",
            tool_name: name,
            tool_input: input,
            tool_use_id: id,
          }),
        );
        let decision:
          | { hookEventName?: unknown; permissionDecision?: unknown; permissionDecisionReason?: unknown }
          | undefined;
        try {
          decision = (JSON.parse(reply.stdout) as { hookSpecificOutput?: typeof decision })
            .hookSpecificOutput;
        } catch {}
        const valid =
          decision?.hookEventName === "PreToolUse" &&
          (decision.permissionDecision === "allow" || decision.permissionDecision === "deny");
        if (reply.code === 0 && valid && decision?.permissionDecision === "deny") {
          ran = false;
          content = `PreToolUse:${name} hook error: ${String(decision.permissionDecisionReason ?? "")}`;
        } else if (reply.code === 2) {
          ran = false;
          content = `PreToolUse:${name} hook error: [${pre.command}]: ${reply.stderr}`;
        } else if (
          !(reply.code === 0 && valid && decision?.permissionDecision === "allow") &&
          ["Write", "Edit", "NotebookEdit"].includes(name)
        ) {
          ran = false;
          content = "Permission denied: no approval surface";
        }
        log({ kind: "tool", id, name, hookExit: reply.code, ran });
      }
      if (
        ran &&
        action.write &&
        typeof action.write === "object" &&
        "path" in action.write &&
        "text" in action.write &&
        typeof action.write.path === "string" &&
        typeof action.write.text === "string"
      )
        writeFileSync(action.write.path, action.write.text);
      if (!ran) denials.push({ tool_name: name, tool_use_id: id, tool_input: input });
      emit({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: id, is_error: !ran, content }] },
      });
    } else throw new Error("Unknown action");
  }
} else {
  process.stderr.write("fake-claude: unknown command");
  process.exitCode = 3;
}
