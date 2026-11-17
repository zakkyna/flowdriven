import { expect, test } from "vitest";
import { classifyCommand } from "./risky.ts";

test("git --attr-source x rm and git --shallow-file x rm are a delete, and git --attr-source x status is not", () => {
  for (const option of ["--attr-source", "--shallow-file"]) {
    expect(classifyCommand(`git ${option} x rm notes.md`)).toBe("delete");
    expect(classifyCommand(`git ${option} x status`)).toBeUndefined();
  }
});
