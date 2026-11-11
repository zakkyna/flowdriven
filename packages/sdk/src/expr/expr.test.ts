import { expect, test } from "vitest";
import { evaluate, parseExpression, references, type Scope, stepView } from "../index.ts";

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
test("compares with the step view and params", () => {
  expect(evaluate("rough.score.value >= params.min_score", scope)).toBe(true);
  expect(
    evaluate("rough.score.value >= params.min_score", {
      ...scope,
      rough: stepView("passed", { score: { value: 6 } }),
    }),
  ).toBe(false);
  expect(evaluate("-1 < 0", {})).toBe(true);
  expect(evaluate("missing > -1", scope)).toBe(false);
});
test("step status and boolean logic", () => {
  expect(evaluate("page.passed", scope)).toBe(false);
  expect(evaluate("not page.passed", scope)).toBe(true);
  expect(evaluate("rough.passed and not page.passed", scope)).toBe(true);
  expect(evaluate("true or false and false", scope)).toBe(true);
});
test("a missing path is undefined and compares false", () => {
  expect(evaluate("rough.nope.value >= 1", scope)).toBe(false);
  expect(evaluate("missing > 1", scope)).toBe(false);
  expect(evaluate("missing == null", scope)).toBe(true);
  expect(evaluate("missing != 3", scope)).toBe(true);
  expect(evaluate("not missing", scope)).toBe(true);
  expect(evaluate("toString", {})).toBeUndefined();
  expect(evaluate("job.valueOf", scope)).toBeUndefined();
});
test("in and strict types", () => {
  expect(evaluate("'x' in job.tags", scope)).toBe(true);
  expect(evaluate("job.id in ['a1','b2']", scope)).toBe(true);
  expect(evaluate("3 in [1,2]", scope)).toBe(false);
  expect(evaluate("'7' >= 7", scope)).toBe(false);
  expect(evaluate("'b' > 'a'", scope)).toBe(true);
});
test("where filters a list, element first, then the scope", () => {
  const keys = (src: string) => (evaluate(src, scope) as { key: string }[]).map((i) => i.key);
  expect(keys("steps.review.items where steps.full.outputs.verdict.fit")).toEqual(["k1"]);
  expect(
    keys("steps.review.items where status == 'passed' and steps.full.outputs.verdict.fit == params.nope"),
  ).toEqual([]);
  expect(keys("steps.review.items where status == 'passed'")).toEqual(["k1", "k2"]);
});
test("references skip where predicates", () => {
  expect(references(parseExpression("rough.score.value >= params.min_score"))).toEqual([
    ["rough", "score", "value"],
    ["params", "min_score"],
  ]);
  expect(references(parseExpression("steps.review.items where steps.full.outputs.verdict.fit"))).toEqual([
    ["steps", "review", "items"],
  ]);
});
test("refuses calls, assignment, ternaries and forbidden names", () => {
  for (const [src, code] of [
    ["f(1)", "syntax"],
    ["x = 1", "syntax"],
    ["a ? b : c", "syntax"],
    ["a.__proto__", "forbidden_name"],
    ["constructor.name", "forbidden_name"],
    ["a.prototype", "forbidden_name"],
    ["a".repeat(501), "too_long"],
    ["(".repeat(21) + "1" + ")".repeat(21), "too_deep"],
  ] as const)
    expect(() => parseExpression(src)).toThrowError(expect.objectContaining({ code }));
});

test("a nested where on a 10 item list is refused or cheap (84 characters, 8 levels)", () => {
  let source = "true";
  for (let i = 0; i < 8; i++) source = `x where (${source})`;
  expect(() => parseExpression(source)).toThrowError(expect.objectContaining({ code: "too_deep" }));
});
test("M3 a path ends in an own property only: array length is not a data path (plan Task 3 attack surface)", () => {
  expect(evaluate("job.tags.length", { job: { tags: ["a", "b"] } })).toBeUndefined();
  expect(evaluate("job.tags[0]", { job: { tags: ["a", "b"] } })).toBe("a");
  expect(evaluate("job.tags[0].length", { job: { tags: [["a"]] } })).toBeUndefined();
  const hidden = Object.defineProperty({}, "secret", { value: "hidden", enumerable: false });
  expect(evaluate("job.secret", { job: hidden })).toBeUndefined();
});
