import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { flowV12Yaml } from "../test-data/flow-v12.ts";
import { loadFlowFolder } from "./load-folder.ts";

const dirs: string[] = [];
const schedule = { type: "weekdays", time: "17:00", whenItsTime: "ask" };
const yaml = () =>
  flowV12Yaml({
    inputs: [{ id: "start", label: "Start", type: "time", default: "now", example: "09:00" }],
    result: { kind: "chat", answer: ["Started at {start}."] },
    touches: [
      {
        id: "save",
        sentence: "Saves a report",
        effect: "change",
        place: { kind: "folder", value: "fs", label: "Reports" },
        rule: "asks_first",
      },
    ],
    schedule,
  });
function folder(text = yaml()) {
  mkdirSync(".workflow/scratch", { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".workflow/scratch/flow-v12-"));
  dirs.push(dir);
  writeFileSync(join(dir, "flow.yaml"), text);
  writeFileSync(join(dir, "README.md"), "Read me\n");
  return dir;
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("TC-SDK-18 loads a 1.2 folder and hashes its bytes", () => {
  const text = yaml();
  const loaded = loadFlowFolder(folder(text));
  expect(loaded.issues).toEqual([]);
  expect(loaded.manifest.format).toBe("flowdriven-flow/1.2");
  expect([...loaded.files.keys()].sort()).toEqual(["README.md", "flow.yaml"]);
  expect(loaded.hash).toBe(`sha256:${sha(`README.md\t${sha("Read me\n")}\nflow.yaml\t${sha(text)}\n`)}`);
});

test("TC-SDK-18 rejects invalid keys and folder limits for 1.2", () => {
  const invalid = loadFlowFolder(folder(flowV12Yaml({ bad_key: true })));
  expect(invalid.issues).toContainEqual(expect.objectContaining({ code: "unknown_field", path: "bad_key" }));
  expect(() => invalid.manifest).toThrow("Flow manifest is invalid");
  const link = folder();
  symlinkSync(join(link, "README.md"), join(link, "link"));
  expect(() => loadFlowFolder(link)).toThrowError(expect.objectContaining({ code: "symlink" }));
  const big = folder();
  writeFileSync(join(big, "big"), new Uint8Array(2_097_153));
  expect(() => loadFlowFolder(big)).toThrowError(expect.objectContaining({ code: "too_large" }));
  const many = folder();
  for (let i = 0; i < 1999; i++) writeFileSync(join(many, `file${i}`), "");
  expect(() => loadFlowFolder(many)).toThrowError(expect.objectContaining({ code: "too_large" }));
});

test("TC-SDK-14 exposes the schedule only as a suggestion", () => {
  const loaded = loadFlowFolder(folder());
  expect(loaded.suggestedSchedule).toEqual(schedule);
  expect(loaded.manifest.triggers).toEqual([]);
  expect(loaded.issues.some((issue) => issue.code === "unattended_prefix")).toBe(false);
});
