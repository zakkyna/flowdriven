import { expect, test } from "vitest";
import { classifyCommand } from "./risky.ts";

test("classifyCommand calls git push with --delete, -d, --mirror, --prune, --force-if-includes or a :ref a delete, and keeps git push origin main undefined", () => {
  for (const word of ["--delete", "-d", "--mirror", "--prune", "--force-if-includes", ":main"])
    expect(classifyCommand(`git push origin ${word}`)).toBe("delete");
  expect(classifyCommand("git push origin main")).toBeUndefined();
});
test("classifyCommand calls every --force form and a bundle of short flags with -f or -d a delete, and keeps other flags undefined", () => {
  for (const word of ["--force-with-lease=main", "--forced", "-uf", "-fu", "-df", "-vd"])
    expect(classifyCommand(`git push ${word} origin main`)).toBe("delete");
  for (const word of ["-u", "--set-upstream", "--tags", "--dry-run", "-n", "--all"])
    expect(classifyCommand(`git push ${word} origin main`)).toBeUndefined();
});
