import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { capabilitySentence } from "./route.ts";

test("the preview says each item works in a folder of its own", () => {
  const req = Requirement.parse({
    id: "work",
    type: "path",
    ref: "~/work",
    access: "read_write",
    per_item: true,
  });
  expect(capabilitySentence(req)).toBe(
    "Reads and changes files in ~/work, a folder outside the project that you grant. Each item works in a folder of its own inside it.",
  );
});
