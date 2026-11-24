import { expect, test } from "vitest";
import { exampleAgentProfile } from "./agent-profiles.ts";

test("the synthetic profile exposes command shapes and catalog values", () => {
  expect(exampleAgentProfile.run).toEqual(["run", "--events"]);
  expect(exampleAgentProfile.status.args).toEqual(["session", "status"]);
  expect(exampleAgentProfile.status.signedIn).toEqual({ stdout: "ready\n", exitCode: 0 });
  expect(exampleAgentProfile.status.signedOut).toEqual({ stdout: "sign in\n", exitCode: 1 });
  expect(exampleAgentProfile.models).toEqual(["example-model", "example-fast"]);
  expect(exampleAgentProfile.install).toEqual({ command: "example-installer", args: ["example-agent"] });
});
