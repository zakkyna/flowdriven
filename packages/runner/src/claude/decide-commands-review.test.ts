import { expect, test } from "vitest";
import { DROP } from "../router/route.ts";
import { decideCommand } from "./commands.ts";

test("a wildcard git pattern still refuses a force-push (+ref) and a remote branch delete (:ref) at the hook", () => {
  const policy = { patterns: ["git push origin *"] };
  for (const ref of ["+main", ":main"])
    expect(decideCommand(policy, { command: `git push origin ${ref}` })).toEqual({
      allow: false,
      reason: DROP.riskyCommand,
    });
  expect(decideCommand(policy, { command: "git push origin main" })).toEqual({ allow: true });
});
test("the hook refuses a concrete line that the route would refuse as a pattern, with the route's reason", () => {
  for (const [pattern, command, reason] of [
    ["find . *", "find . -delete", DROP.riskyCommand],
    ["git *", "git submodule foreach echo", DROP.runsAnything],
    ["xcrun *", "xcrun python3 script", DROP.runsAnything],
  ]) {
    if (pattern === undefined || command === undefined || reason === undefined)
      throw new Error("Missing case");
    // Fixed flags cannot pass a wildcard, so this case uses an exact declaration.
    const declared = command === "find . -delete" ? command : pattern;
    expect(decideCommand({ patterns: [declared] }, { command })).toEqual({ allow: false, reason });
  }
});
