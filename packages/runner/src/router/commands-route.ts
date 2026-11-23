import { classifyCommand, gitSubcommand } from "@flowdriven/sdk";
import { REFUSED_FLAGS } from "../claude/args.ts";
import { isInside, resolveDeep } from "../claude/paths.ts";
import { protectedPath } from "../claude/protected.ts";
import { DROP } from "./route.ts";

const runsAnything = new Set(
  ". source sh bash zsh dash ksh csh tcsh fish noglob nocorrect env xargs nohup nice time timeout exec eval command sudo su doas osascript open script expect watch npx pnpx bunx curl wget ssh scp sftp rsync nc telnet ftp xcrun arch caffeinate ssh-agent taskpolicy sandbox-exec launchctl shortcuts automator crontab at batch lldb gdb dtrace dtruss strace ltrace valgrind stdbuf setsid unbuffer flock screen tmux parallel chroot pkexec runuser busybox builtin coproc trap pwsh repeat foreach select case if while until for function alias unalias hash rehash enable disable functions unfunction autoload zmodload emulate setopt unsetopt set shopt export typeset declare local readonly unset fc r cd pushd popd ulimit umask gh dig host nslookup ping ping6 whois traceroute traceroute6 mtr socat ncat openssl tftp uvx pipx bundle docker podman codex claude gemini agy copilot opencode aider goose cursor-agent amp crush qwen".split(
    " ",
  ),
);
const interpreters = new Set(
  "node nodejs python python3 ruby perl php deno bun lua dart npm pnpm yarn pip pip3 uv poetry gem cargo go brew composer swift awk gawk mawk nawk tclsh rscript".split(
    " ",
  ),
);
// find actions that delete, write files or run other programs.
const FIND_ACTS = new Set("-delete -exec -execdir -ok -okdir -fprint -fprint0 -fprintf -fls".split(" "));
const NETWORK_GIT = new Set(
  "fetch pull clone ls-remote remote submodule send-email request-pull daemon instaweb http-backend imap-send svn p4".split(
    " ",
  ),
);

export function commandRefusal(pattern: string): string | undefined {
  const words = pattern.split(" ");
  const program = (words[0] ?? "").toLowerCase();
  if (program.startsWith("-")) return DROP.runsAnything;
  if (
    classifyCommand(pattern) ||
    program === "dd" ||
    (program === "find" && words.some((word) => FIND_ACTS.has(word))) ||
    (program === "git" && (words.includes("clean") || (words.includes("reset") && words.includes("--hard"))))
  )
    return DROP.riskyCommand;
  if (
    runsAnything.has(program) ||
    (program === "git" && gitSubcommand(words) === "config") ||
    (program === "git" && (words.includes("foreach") || (words.includes("bisect") && words.includes("run"))))
  )
    return DROP.runsAnything;
  if (words.some((word) => protectedPath(word.replace(/[=:,@]/g, "/")))) return DROP.protectedPath;
  // A name with a version, such as python3.13 or pip3.13, is the same interpreter as its plain name.
  const interpreter =
    interpreters.has(program) || /^(python|pip|ruby|perl|php|node|lua|tclsh)[0-9][0-9.]*$/.test(program);
  if (interpreter && pattern.endsWith(" *")) return DROP.interpreterWildcard;
  if (program === "git") {
    const subcommand = gitSubcommand(words);
    if (subcommand === undefined || subcommand === "*") return DROP.gitSubcommand;
    if (NETWORK_GIT.has(subcommand)) return DROP.runsAnything;
    if (subcommand === "push") {
      const index = words.findIndex((_, i) => gitSubcommand(words.slice(0, i + 1)) === subcommand);
      const remote = words.slice(index + 1).find((word) => !word.startsWith("-"));
      if (remote === undefined || !/^[A-Za-z0-9_-]+$/.test(remote)) return DROP.pushRemote;
    }
  }
  return undefined;
}

// Tokenise only shell text whose words can be known before execution. Quoted strings are
// kept as words; shell -c and eval arguments are checked again as shell source.
export function unsafeShellLine(
  line: string,
  scope?: { roots: string[]; projectRoot?: string },
  depth = 0,
): boolean {
  if (depth > 12) return true;
  const tokens: string[] = [];
  let word = "";
  let started = false;
  let quote: "single" | "double" | undefined;
  const flush = () => {
    if (started) tokens.push(word);
    word = "";
    started = false;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? "";
    if (quote === "single") {
      if (c === "'") quote = undefined;
      else word += c;
      started = true;
      continue;
    }
    if (c === "'" && quote === undefined) {
      quote = "single";
      started = true;
      continue;
    }
    if (c === '"') {
      quote = quote === "double" ? undefined : "double";
      started = true;
      continue;
    }
    if (c === "\\") {
      const next = line[++i];
      if (next === undefined) return true;
      if (quote === "double" && !["$", "`", '"', "\\", "\n"].includes(next)) word += "\\";
      if (next !== "\n") word += next;
      started = true;
      continue;
    }
    if (c === "$" || c === "`" || (quote === undefined && "{*?[~".includes(c))) return true;
    if (quote === undefined && /\s/.test(c)) {
      flush();
      if (c === "\n") tokens.push(";");
      continue;
    }
    if (quote === undefined && ";&|()<>".includes(c)) {
      flush();
      let op = c;
      const next = line[i + 1];
      if (
        (c === "<" && (next === "<" || next === ">")) ||
        (c === ">" && (next === ">" || next === "|" || next === "&")) ||
        (c === "&" && (next === "&" || next === ">")) ||
        (c === "|" && next === "|")
      ) {
        op += next;
        i++;
      }
      if (op === "<<") return true;
      tokens.push(op);
      continue;
    }
    word += c;
    started = true;
  }
  if (quote) return true;
  flush();
  const shells = new Set("sh bash zsh dash ksh fish csh tcsh".split(" "));
  const agents = new Set(
    "claude codex gemini agy copilot opencode aider goose cursor-agent amp crush qwen".split(" "),
  );
  const separators = new Set([";", "&&", "||", "|", "&", "(", ")"]);
  const redirections = new Set(["<", ">", ">>", "<>", ">|", ">&", "&>"]);
  let command = true;
  let wrapped = false;
  let redirect = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (separators.has(token)) {
      if (redirect) return true;
      command = true;
      wrapped = false;
      continue;
    }
    if (redirections.has(token)) {
      if (redirect) return true;
      redirect = true;
      continue;
    }
    const lower = token.toLowerCase();
    const parts = lower.split("/");
    const last = parts.at(-1) ?? "";
    if (
      parts.some((part) =>
        [".git", ".claude", ".mcp.json", ".claude.json", ".codex", "keychains", ".."].includes(part),
      ) ||
      last === "security" ||
      REFUSED_FLAGS.some((flag) => lower === flag || lower.startsWith(`${flag}=`)) ||
      lower === "--full-auto" ||
      /dangerously|danger-full-access|bypasspermissions/.test(lower)
    )
      return true;
    if (scope) {
      const candidates = [token, ...token.split(/[=@:]/).slice(1)];
      for (let candidate of candidates) {
        if (!candidate.startsWith("/")) continue;
        candidate = candidate.replace(/^\/System\/Volumes\/Data(?=\/)/i, "");
        const path = resolveDeep(candidate);
        if (!path) return true;
        const folded = path.toLowerCase();
        const within = (root: string) => {
          const resolvedRoot = resolveDeep(root);
          return resolvedRoot !== undefined && isInside(resolvedRoot.toLowerCase(), folded);
        };
        if (scope.roots.some(within) && !(scope.projectRoot && within(scope.projectRoot))) return true;
      }
    }
    if (redirect) {
      redirect = false;
      continue;
    }
    const wrapper = new Set(
      "env xargs nohup timeout nice time exec command sudo doas stdbuf setsid".split(" "),
    );
    const isCommand = command || wrapped;
    if (isCommand && (agents.has(last) || ["source", ".", "cd", "pushd", "popd"].includes(last))) return true;
    if (command && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    if (command) {
      wrapped = wrapper.has(last);
      command = false;
    }
    if (!isCommand) continue;
    if (last === "eval") {
      if (unsafeShellLine(tokens.slice(i + 1).join(" "), scope, depth + 1)) return true;
    }
    if (shells.has(last)) {
      let script: string | undefined;
      for (let j = i + 1; j < tokens.length && !separators.has(tokens[j] ?? ""); j++) {
        const flag = tokens[j] ?? "";
        if (/^-([a-z]*c[a-z]*)$/i.test(flag)) {
          script = tokens[j + 1];
          break;
        }
        if (!flag.startsWith("-")) break;
      }
      if (script === undefined || unsafeShellLine(script, scope, depth + 1)) return true;
    }
  }
  return redirect;
}
