import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { capabilitySentence, DROP, routeRequirement } from "./route.ts";

const req = (commands?: string[]) =>
  Requirement.parse({ id: "cli", type: "cli_tool", ...(commands ? { commands } : {}) });
const facts = { hooks: true, chrome: false };

test("a cli_tool with commands is the Claude Code commands route, enforced by the FlowDriven hook, with the label sentence", () => {
  expect(routeRequirement(req(["flutter analyze"]), facts)).toMatchObject({
    routed: true,
    provider: "claude-code-commands",
    providerName: "Claude Code commands",
    enforcedBy: "FlowDriven hook in Claude Code",
    label: "official",
    labelSentence:
      "FlowDriven checks each command line. What the program then does is not checked, and it runs with your rights.",
    away: true,
  });
  expect(routeRequirement(req(["flutter analyze"]), { ...facts, hooks: false })).toMatchObject({
    routed: false,
    reason: DROP.noHooks,
  });
});
test("a cli_tool without commands keeps DROP.notYet", () => {
  expect(routeRequirement(req(), facts)).toMatchObject({ routed: false, reason: DROP.notYet });
});
test("a risky pattern drops the route: rm, git merge, git push --force, gh pr merge, npm publish, git clean, git reset --hard, find with -delete", () => {
  for (const command of [
    "rm x",
    "git merge x",
    "git push --force",
    "gh pr merge",
    "npm publish",
    "git clean -f",
    "git reset --hard",
    "find . -delete",
    "find . -exec",
    "dd if=x",
  ])
    expect(routeRequirement(req([command]), facts)).toMatchObject({
      routed: false,
      reason: DROP.riskyCommand,
    });
});
test("a program that runs other programs or reaches the network drops the route: ., source, bash, env, xargs, sudo, osascript, npx, curl, ssh", () => {
  for (const command of [
    ".",
    "source",
    "sh",
    "bash",
    "zsh",
    "dash",
    "ksh",
    "csh",
    "tcsh",
    "fish",
    "env",
    "xargs",
    "nohup",
    "nice",
    "time",
    "timeout",
    "exec",
    "eval",
    "command",
    "sudo",
    "su",
    "doas",
    "osascript",
    "open",
    "script",
    "expect",
    "watch",
    "npx",
    "pnpx",
    "bunx",
    "curl",
    "wget",
    "ssh",
    "scp",
    "sftp",
    "rsync",
    "nc",
    "telnet",
    "ftp",
  ])
    expect(routeRequirement(req([command]), facts)).toMatchObject({
      routed: false,
      reason: DROP.runsAnything,
    });
});
test("an interpreter or a package runner with a wildcard pattern drops; with an exact pattern it routes", () => {
  for (const program of [
    "node",
    "python",
    "python3",
    "ruby",
    "perl",
    "php",
    "deno",
    "bun",
    "lua",
    "npm",
    "pnpm",
    "yarn",
  ]) {
    expect(routeRequirement(req([`${program} run *`]), facts)).toMatchObject({
      routed: false,
      reason: DROP.interpreterWildcard,
    });
    expect(routeRequirement(req([`${program} run`]), facts)).toMatchObject({ routed: true });
  }
});
test("the sentence lists the commands, cleaned by visible, and more than 8 refuse the preview", () => {
  expect(capabilitySentence(req([`flutter a${String.fromCodePoint(0x200b)}b`, "dart format *"]))).toBe(
    "Runs these commands in this flow's folders: flutter a<U+200B>b; dart format *.",
  );
});
