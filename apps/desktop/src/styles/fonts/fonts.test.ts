import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("T17 all bundled TrueType font hashes are reviewed", () => {
  const root = resolve(import.meta.dirname, "../..");
  const hashes: Record<string, string> = {
    "styles/fonts/PlusJakartaSans-VariableFont.ttf":
      "89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8",
  };
  const files = globSync("**/*.ttf", { cwd: root }).sort();
  const errors = files.flatMap((file) => {
    const hash = createHash("sha256")
      .update(readFileSync(resolve(root, file)))
      .digest("hex");
    return hashes[file] === hash ? [] : [`Font is unlisted or changed: ${file}`];
  });
  for (const file of Object.keys(hashes)) if (!files.includes(file)) errors.push(`Font is missing: ${file}`);
  expect(errors.join("\n")).toBe("");
});
