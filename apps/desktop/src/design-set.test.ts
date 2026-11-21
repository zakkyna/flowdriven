import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(resolve(root, "docs/design", path), "utf8");
const caseId = /TC-[A-Za-z0-9]+-\d+/g;

function nfFindings(prd: string, plan: string): string[] {
  const defined = new Set([...prd.matchAll(/^\| (NF-\d+) \|/gm)].map((match) => match[1] ?? ""));
  const table = plan
    .split("NF coverage (the check `TC-REPO-12` reads the ids in this table):")[1]
    ?.split("\n\n")[1];
  if (!table) throw new Error("NF coverage table missing");
  const covered = new Set(
    [...table.matchAll(/^\| ([^|]+) \|/gm)].flatMap((match) => (match[1] ?? "").match(/NF-\d+/g) ?? []),
  );
  return [
    ...[...defined].filter((id) => !covered.has(id)).map((id) => `missing NF id: ${id}`),
    ...[...covered].filter((id) => !defined.has(id)).map((id) => `unknown NF id: ${id}`),
  ];
}

function orderFindings(order: string, files: string[]): string[] {
  const section = order.split("## 3. V1 steps in build order")[1]?.split("\n### B-00")[0];
  if (!section) throw new Error("Build order table missing");
  const steps = new Map<string, number>();
  const tasks = new Map<string, number>();
  for (const row of section.matchAll(/^\| (\d+) \| ([^|]+) \|/gm)) {
    const value = Number(row[1]);
    const entry = row[2] ?? "";
    for (const range of entry.matchAll(/(B-\d+\.T)(\d+) to B-\d+\.T(\d+)/g)) {
      for (let n = Number(range[2]); n <= Number(range[3]); n++) tasks.set(`${range[1]}${n}`, value);
    }
    for (const task of entry.match(/B-\d+\.T\d+/g) ?? []) tasks.set(task, value);
    if (/^B-\d+$/.test(entry.trim())) steps.set(entry.trim(), value);
  }
  const citations = new Map<string, string>();
  for (const line of order.split("\n")) {
    const task = line.match(/\*\*(B-\d+\.T\d+)\b/)?.[1];
    const cited = line.match(/Tests first: ([^.]+)/)?.[1];
    if (task && cited) for (const id of cited.match(caseId) ?? []) citations.set(id, task);
  }
  const findings: string[] = [];
  for (const file of files) {
    for (const block of file.split(/(?=^### TC-)/m)) {
      const id = block.match(/^### (TC-[A-Za-z0-9]+-\d+)/)?.[1];
      const given = block.match(/^- Given: (.*)/m)?.[1];
      if (!id || !given) continue;
      for (const reference of given.match(caseId) ?? []) {
        const task = citations.get(id);
        const otherTask = citations.get(reference);
        if (!task || !otherTask) {
          findings.push(`missing task: ${id} or ${reference}`);
          continue;
        }
        if (task === otherTask) continue;
        const current = tasks.get(task) ?? steps.get(task.split(".")[0] ?? "");
        const other = tasks.get(otherTask) ?? steps.get(otherTask.split(".")[0] ?? "");
        if (current === undefined || other === undefined) {
          findings.push(`missing order: ${id} ${task}, ${reference} ${otherTask}`);
          continue;
        }
        if (other > current)
          findings.push(`${id} ${task} (${current}) names ${reference} ${otherTask} (${other})`);
      }
    }
  }
  return findings;
}

test("TC-REPO-12 checks NF coverage and reports missing and unknown ids", () => {
  const prd = read("prd.md");
  const plan = read("test-plan.md");
  expect(nfFindings(prd, plan)).toEqual([]);
  expect(nfFindings(`${prd}\n| NF-999 | Scratch | test |\n`, plan)).toContain("missing NF id: NF-999");
  expect(
    nfFindings(
      prd,
      plan.replace("| NF-43 | Measured target, L5-08 |", "| NF-43, NF-999 | Measured target, L5-08 |"),
    ),
  ).toContain("unknown NF id: NF-999");
});

test("TC-REPO-13 checks Given references using each task's order", () => {
  const order = read("build-order.md");
  const files = ["journeys.md", "safety.md", "platform.md"].map((name) => read(`test-cases/${name}`));
  expect(orderFindings(order, files)).toEqual([]);
  const scratchOrder = `## 3. V1 steps in build order\n| 1 | B-01.T1 | early |\n| 2 | B-01.T2 | later |\n### B-00\n- **B-01.T1 Early.** Tests first: TC-TEST-01.\n- **B-01.T2 Later.** Tests first: TC-TEST-02.`;
  const scratch = "### TC-TEST-01 Early\n- Given: TC-TEST-02.\n### TC-TEST-02 Later\n- Given: TC-TEST-01.";
  expect(orderFindings(scratchOrder, [scratch])).toEqual([
    "TC-TEST-01 B-01.T1 (1) names TC-TEST-02 B-01.T2 (2)",
  ]);
});
