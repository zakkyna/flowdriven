import { expect, test } from "vitest";

const input = (type: string, extra: Record<string, unknown> = {}) => ({
  id: "item",
  label: "Item",
  type,
  ...extra,
});
const choices = [
  { key: "meeting", label: "Meeting" },
  { key: "bug_fix", label: "Bug fix" },
];

test("TC-SDK-04 new input types and choice alias", async () => {
  const { InputDeclV12 } = await import("./inputs.ts");
  for (const type of ["time", "duration", "longtext"])
    expect(InputDeclV12.safeParse(input(type)).success).toBe(true);
  for (const type of ["choice", "enum"])
    expect(InputDeclV12.parse(input(type, { choices })).type).toBe("choice");
  const manyChoices = Array.from({ length: 51 }, (_, i) => ({ key: `c${i}`, label: `Choice ${i}` }));
  expect(InputDeclV12.safeParse(input("choice", { choices: manyChoices.slice(0, 50) })).success).toBe(true);
  for (const c of [undefined, [], manyChoices, [{ key: "Bug Fix", label: "Bad" }], [choices[0], choices[0]]])
    expect(InputDeclV12.safeParse(input("choice", { choices: c })).success).toBe(false);
  expect(InputDeclV12.safeParse(input("datetime")).success).toBe(false);
});
test("TC-SDK-05 example and remember", async () => {
  const { InputDeclV12 } = await import("./inputs.ts");
  expect(InputDeclV12.parse(input("duration", { example: "2 hours" })).remember).toBe(false);
  expect(InputDeclV12.safeParse(input("text", { remember: true })).success).toBe(true);
  for (const n of [200, 201])
    expect(InputDeclV12.safeParse(input("text", { example: "x".repeat(n) })).success).toBe(n === 200);
  for (const type of ["date", "time"]) {
    const result = InputDeclV12.safeParse(input(type, { remember: true }));
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]).toMatchObject({ params: { code: "remember_date_time" } });
  }
});
test("TC-SDK-06 typed defaults", async () => {
  const { InputDeclV12, defaultKind } = await import("./inputs.ts");
  for (const [type, value, valid] of [
    ["date", "today", true],
    ["time", "now", true],
    ["number", "today", false],
    ["date", "now", false],
    ["duration", 480, true],
    ["duration", "today", false],
  ] as const) {
    const result = InputDeclV12.safeParse(input(type, { default: value }));
    expect(result.success).toBe(valid);
    if (result.success && (value === "today" || value === "now"))
      expect(defaultKind(result.data)).toBe(value);
  }
  expect(
    InputDeclV12.safeParse(input("choice", { choices, default: "meeting", required: true })).success,
  ).toBe(true);
  expect(InputDeclV12.safeParse(input("choice", { choices, default: "coding" })).success).toBe(false);
  expect(InputDeclV12.safeParse(input("number", { min: 1, max: 10, default: 11 })).success).toBe(false);
});

test.each(["label", "choice label"])("TC-SDK-04 %s display limits", async (field) => {
  const { InputDeclV12 } = await import("./inputs.ts");
  const make = (label: string) =>
    field === "label" ? input("text", { label }) : input("choice", { choices: [{ key: "x", label }] });
  expect(InputDeclV12.safeParse(make("x".repeat(200))).success).toBe(true);
  expect(InputDeclV12.safeParse(make("x".repeat(201))).success).toBe(false);
  expect(InputDeclV12.safeParse(make("")).success).toBe(false);
});
test("TC-SDK-06 default length limits", async () => {
  const { InputDeclV12 } = await import("./inputs.ts");
  expect(InputDeclV12.safeParse(input("longtext", { default: "x".repeat(4000) })).success).toBe(true);
  for (const [type, value] of [
    ["longtext", "x".repeat(4001)],
    ["list<text>", ["x".repeat(4001)]],
  ] as const) {
    const result = InputDeclV12.safeParse(input(type, { default: value }));
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ message: "Default does not match input type", path: ["default"] }),
      );
  }
});
test("TC-SDK-05 secret reference cannot be remembered", async () => {
  const { InputDeclV12 } = await import("./inputs.ts");
  const result = InputDeclV12.safeParse(input("secret_ref", { remember: true }));
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ path: ["remember"], params: { code: "remember_secret" } }),
    );
  expect(InputDeclV12.safeParse(input("secret_ref", { default: "example-api-key" })).success).toBe(true);
});
