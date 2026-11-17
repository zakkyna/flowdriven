import { classifyCommand } from "@flowdriven/sdk";
import { DROP } from "./route.ts";

const runsAnything = new Set(
  ". source sh bash zsh dash ksh csh tcsh fish env xargs nohup nice time timeout exec eval command sudo su doas osascript open script expect watch npx pnpx bunx curl wget ssh scp sftp rsync nc telnet ftp".split(
    " ",
  ),
);
const interpreters = new Set("node python python3 ruby perl php deno bun lua npm pnpm yarn".split(" "));
// find actions that delete, write files or run other programs.
const FIND_ACTS = new Set("-delete -exec -execdir -ok -okdir -fprint -fprint0 -fprintf -fls".split(" "));

export function commandRefusal(pattern: string): string | undefined {
  const words = pattern.split(" ");
  const program = words[0] ?? "";
  if (
    classifyCommand(pattern) ||
    program === "dd" ||
    (program === "find" && words.some((word) => FIND_ACTS.has(word))) ||
    (program === "git" && (words.includes("clean") || (words.includes("reset") && words.includes("--hard"))))
  )
    return DROP.riskyCommand;
  if (runsAnything.has(program)) return DROP.runsAnything;
  if (interpreters.has(program) && pattern.endsWith(" *")) return DROP.interpreterWildcard;
  return undefined;
}
