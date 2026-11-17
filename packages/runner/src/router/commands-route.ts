import { classifyCommand } from "@flowdriven/sdk";
import { DROP } from "./route.ts";

const runsAnything = new Set(
  ". source sh bash zsh dash ksh csh tcsh fish noglob nocorrect env xargs nohup nice time timeout exec eval command sudo su doas osascript open script expect watch npx pnpx bunx curl wget ssh scp sftp rsync nc telnet ftp xcrun arch caffeinate ssh-agent taskpolicy sandbox-exec launchctl shortcuts automator crontab at batch lldb gdb dtrace dtruss strace ltrace valgrind stdbuf setsid unbuffer flock screen tmux parallel chroot pkexec runuser busybox builtin coproc trap pwsh repeat foreach select case if while until for function alias unalias hash rehash enable disable functions unfunction autoload zmodload emulate setopt unsetopt set shopt export typeset declare local readonly unset fc r cd pushd popd ulimit umask".split(
    " ",
  ),
);
const interpreters = new Set(
  "node python python3 ruby perl php deno bun lua npm pnpm yarn swift awk gawk mawk nawk tclsh Rscript".split(
    " ",
  ),
);
// find actions that delete, write files or run other programs.
const FIND_ACTS = new Set("-delete -exec -execdir -ok -okdir -fprint -fprint0 -fprintf -fls".split(" "));

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
    (program === "git" && (words.includes("foreach") || (words.includes("bisect") && words.includes("run"))))
  )
    return DROP.runsAnything;
  if (interpreters.has(program) && pattern.endsWith(" *")) return DROP.interpreterWildcard;
  return undefined;
}
