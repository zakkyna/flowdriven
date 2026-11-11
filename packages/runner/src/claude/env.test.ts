import { expect, test } from "vitest";
import { CHILD_ENV_NAMES, childEnv } from "./env.ts";

test("the child gets exactly HOME, USER, PATH, TMPDIR and LANG, and only the ones the runner has", () => {
  const allowed = { HOME: "h", USER: "u", PATH: "p", TMPDIR: "t", LANG: "l" };
  expect(
    childEnv({
      ...allowed,
      LOGNAME: "x",
      SHELL: "x",
      ANTHROPIC_API_KEY: "x",
      CLAUDE_CONFIG_DIR: "x",
      NODE_OPTIONS: "x",
      ELECTRON_RUN_AS_NODE: "x",
    }),
  ).toEqual(allowed);
  expect(childEnv({ PATH: "p" })).toEqual({ PATH: "p" });
  expect(CHILD_ENV_NAMES.some((name) => name.startsWith("ANTHROPIC_") || name.startsWith("CLAUDE_"))).toBe(
    false,
  );
});
