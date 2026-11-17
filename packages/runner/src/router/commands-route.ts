import { classifyCommand, gitSubcommand } from "@flowdriven/sdk";
import { protectedPath } from "../claude/protected.ts";
import { DROP } from "./route.ts";

const runsAnything = new Set(
  ". source sh bash zsh dash ksh csh tcsh fish noglob nocorrect env xargs nohup nice time timeout exec eval command sudo su doas osascript open script expect watch npx pnpx bunx curl wget ssh scp sftp rsync nc telnet ftp xcrun arch caffeinate ssh-agent taskpolicy sandbox-exec launchctl shortcuts automator crontab at batch lldb gdb dtrace dtruss strace ltrace valgrind stdbuf setsid unbuffer flock screen tmux parallel chroot pkexec runuser busybox builtin coproc trap pwsh repeat foreach select case if while until for function alias unalias hash rehash enable disable functions unfunction autoload zmodload emulate setopt unsetopt set shopt export typeset declare local readonly unset fc r cd pushd popd ulimit umask gh dig host nslookup ping ping6 whois traceroute traceroute6 mtr socat ncat openssl tftp uvx pipx bundle docker podman".split(
    " ",
  ),
);
const interpreters = new Set(
  "node nodejs python python3 ruby perl php deno bun lua npm pnpm yarn pip pip3 uv poetry gem cargo go brew composer swift awk gawk mawk nawk tclsh Rscript".split(
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
  const program = words[0] ?? "";
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
