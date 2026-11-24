import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { flowV12Yaml } from "../test-data/flow-v12.ts";
import { upworkYaml } from "../test-data/upwork-yaml.ts";
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

test("TC-SDK-02 loads the 1.1 sample with its independently computed hash", () => {
  const files: Record<string, string> = {
    "flow.yaml": upworkYaml,
    "README.md": "r\n",
    "checks/alerts.schema.json": "{}",
    "checks/score.schema.json": "{}",
    "checks/verdict.schema.json": "{}",
    "checks/human.md": "rubric\n",
  };
  const dir = folder(upworkYaml);
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const loaded = loadFlowFolder(dir);
  expect(loaded.manifest.format).toBe("flowdriven-flow/1.1");
  expect([...loaded.files.keys()].sort()).toEqual(Object.keys(files).sort());
  const listing = [...loaded.files.keys()]
    .sort()
    .map((path) => `${path}\t${sha(readFileSync(join(dir, path), "utf8"))}\n`)
    .join("");
  expect(loaded.hash).toBe(`sha256:${sha(listing)}`);
});

function forbiddenImports(source: string): string[] {
  const imports =
    /\b(?:import\s*(?:\(\s*)?(?:[^"'();]*?\sfrom\s*)?|export\s+[^"';]*?\sfrom\s*)["']([^"']+)["']/g;
  return [...source.matchAll(imports)]
    .map((match) => match[1] ?? "")
    .filter((specifier) => /@flowdriven\/runner|storage|sqlite/i.test(specifier));
}

test("TC-SDK-14 SDK source does not import the runner or store", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files: string[] = [];
  function collect(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
    }
  }
  collect(root);
  expect(files.length).toBeGreaterThan(0);
  for (const path of files) expect(forbiddenImports(readFileSync(path, "utf8")), path).toEqual([]);
  for (const source of [
    'import { x } from "@flowdriven/runner";',
    'import "./storage";',
    'export { x } from "./storage";',
    'const x = import("node:sqlite");',
  ])
    expect(forbiddenImports(source)).toHaveLength(1);
});
