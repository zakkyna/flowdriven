import { expect, test } from "vitest";
import { classifyCommand } from "./risky.ts";

test("classifyCommand calls RM x, Rmdir y and Git push --force origin main a delete", () => {
  for (const command of ["RM x", "Rmdir y", "Git push --force origin main", "/bin/RM x", "Git rm x"])
    expect(classifyCommand(command), command).toBe("delete");
});
