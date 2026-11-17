import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { DROP, routeRequirement } from "./route.ts";

const route = (command: string) =>
  routeRequirement(Requirement.parse({ id: "cli", type: "cli_tool", commands: [command] }), {
    hooks: true,
    chrome: false,
  });

test("xcrun, arch, caffeinate and ssh-agent drop the route, and so does every other program on the list", () => {
  for (const program of "xcrun arch caffeinate ssh-agent taskpolicy sandbox-exec launchctl shortcuts automator crontab at batch lldb gdb dtrace dtruss strace ltrace valgrind stdbuf setsid unbuffer flock screen tmux parallel chroot pkexec runuser busybox builtin coproc trap pwsh".split(
    " ",
  ))
    expect(route(`${program} *`)).toMatchObject({ routed: false, reason: DROP.runsAnything });
});
test("swift and awk run only as an exact line, and git submodule foreach and git bisect run drop the route", () => {
  for (const program of "swift awk gawk mawk nawk tclsh Rscript".split(" ")) {
    expect(route(`${program} script`)).toMatchObject({ routed: true });
    expect(route(`${program} *`)).toMatchObject({ routed: false, reason: DROP.interpreterWildcard });
  }
  for (const command of ["git submodule foreach echo", "git bisect run test"])
    expect(route(command)).toMatchObject({ routed: false, reason: DROP.runsAnything });
  expect(route("git bisect status")).toMatchObject({ routed: true });
});
