import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { decideCommand } from "../claude/commands.ts";
import { DROP, routeRequirement } from "./route.ts";

const route = (command: string) =>
  routeRequirement(Requirement.parse({ id: "cli", type: "cli_tool", commands: [command] }), {
    hooks: true,
    chrome: false,
  });

const refused = (command: string, reason: string) => {
  expect(route(command), command).toMatchObject({ routed: false, reason });
  if (!command.includes("*"))
    expect(decideCommand({ patterns: [command] }, { command }), command).toEqual({ allow: false, reason });
};

test("gh, dig, host, nslookup, ping, whois, traceroute and the other network programs drop the route and are refused at the hook", () => {
  for (const program of "gh dig host nslookup ping ping6 whois traceroute traceroute6 mtr socat ncat openssl tftp".split(
    " ",
  )) {
    const command = `${program} example`;
    refused(command, DROP.runsAnything);
    expect(decideCommand({ patterns: [`${program} *`] }, { command })).toEqual({
      allow: false,
      reason: DROP.runsAnything,
    });
  }
});

test("git fetch, pull, clone, ls-remote, remote, submodule, send-email and the other network subcommands drop the route and are refused at the hook", () => {
  for (const subcommand of "fetch pull clone ls-remote remote submodule send-email request-pull daemon instaweb http-backend imap-send svn p4".split(
    " ",
  )) {
    const command = `git ${subcommand} origin`;
    refused(command, DROP.runsAnything);
    expect(decideCommand({ patterns: ["git *"] }, { command })).toEqual({
      allow: false,
      reason: DROP.runsAnything,
    });
    refused(`git -C dir ${subcommand} origin`, DROP.runsAnything);
  }
});

test("a git line must name its subcommand: git * drops, and git status and git add * still route", () => {
  const reason = "A git command line must name its subcommand.";
  for (const command of ["git *", "git", "git -C dir", "git -C dir *"]) refused(command, reason);
  for (const command of ["git status", "git add *"]) expect(route(command)).toMatchObject({ routed: true });
  expect(decideCommand({ patterns: ["git status"] }, { command: "git status" })).toEqual({ allow: true });
  expect(decideCommand({ patterns: ["git add *"] }, { command: "git add file" })).toEqual({ allow: true });
});

test("git push must name a plain remote: git push * and a push to other-host:repo or user@host:repo are refused, and git push origin * routes and allows git push origin main", () => {
  const reason = "A git push must name its remote, such as origin.";
  for (const command of [
    "git push *",
    "git push",
    "git push --verbose",
    "git push other-host:repo",
    "git push user@host:repo",
    "git -C dir push other-host:repo",
  ])
    refused(command, reason);
  for (const command of [
    "git push origin *",
    "git push --verbose remote_1 main",
    "git -C dir push origin main",
  ])
    expect(route(command)).toMatchObject({ routed: true });
  expect(decideCommand({ patterns: ["git push origin *"] }, { command: "git push origin main" })).toEqual({
    allow: true,
  });
  for (const command of ["git push other-host:repo main", "git push user@host:repo main"]) {
    expect(decideCommand({ patterns: ["git push *"] }, { command })).toEqual({ allow: false, reason });
  }
});

test("uvx, pipx, bundle, docker and podman drop the route, and package managers and versioned interpreters run only as an exact line", () => {
  for (const program of ["uvx", "pipx", "bundle", "docker", "podman"])
    refused(`${program} run x`, DROP.runsAnything);
  for (const program of [
    "pip",
    "pip3",
    "uv",
    "poetry",
    "gem",
    "cargo",
    "go",
    "brew",
    "composer",
    "nodejs",
    "python3.13",
    "pip3.13",
    "ruby3.3",
    "perl5.30",
    "php8.2",
    "lua5.4",
    "tclsh8.6",
  ]) {
    expect(route(`${program} *`), program).toMatchObject({ routed: false, reason: DROP.interpreterWildcard });
    expect(route(`${program} list`), program).toMatchObject({ routed: true });
  }
  expect(route("python3x *")).toMatchObject({ routed: true });
});
