import { expect, test } from "vitest";
import { interpolate, resolveValue, type Scope, stepView, templateExpressions } from "../index.ts";

const scope: Scope = {
  params: { min_score: 7 },
  inputs: {},
  job: { id: "a1", tags: ["x", "y"] },
  rough: stepView("passed", { score: { value: 8 } }),
  page: stepView("skipped", {}),
  steps: {
    alerts: stepView("passed", { jobs: [{ id: "a1" }] }),
    review: {
      items: [
        {
          key: "k1",
          item: { id: "a1" },
          status: "passed",
          steps: { full: { outputs: { verdict: { fit: true } } } },
        },
        {
          key: "k2",
          item: { id: "b2" },
          status: "passed",
          steps: { full: { outputs: { verdict: { fit: false } } } },
        },
        { key: "k3", item: { id: "c3" }, status: "skipped", steps: {} },
      ],
    },
  },
};
test("interpolates strings, numbers and objects", () => {
  expect(interpolate("id ${job.id} / ${params.min_score}", scope)).toBe("id a1 / 7");
  expect(interpolate("Score ${job} 0-10", scope)).toBe('Score {"id":"a1","tags":["x","y"]} 0-10');
});
test("expands a reference once", () => {
  const evil = { ...scope, job: { id: "${params.min_score}" } };
  expect(interpolate("${job.id}", evil)).toBe("${params.min_score}");
  expect(interpolate("cost $${x}", {})).toBe("cost ${x}");
});
test("an unresolved reference throws and names the path", () =>
  expect(() => interpolate("${job.nope}", scope)).toThrowError(
    expect.objectContaining({ code: "unresolved", message: expect.stringContaining("job.nope") }),
  ));
test("resolveValue keeps the type of a whole-value reference", () => {
  expect(resolveValue("${steps.alerts.outputs.jobs}", scope)).toEqual([{ id: "a1" }]);
  expect(resolveValue("${params.min_score}", scope)).toBe(7);
  expect(resolveValue("max ${params.min_score}", scope)).toBe("max 7");
  expect(resolveValue("5", scope)).toBe("5");
});
test("lists the expressions of a template and refuses an unclosed one", () => {
  expect(templateExpressions("a ${x.y} b ${z}")).toEqual(["x.y", "z"]);
  expect(() => templateExpressions("a ${x")).toThrowError(expect.objectContaining({ code: "syntax" }));
});
