import { expect, test } from "vitest";
import { validateJsonSchema } from "./json-schema.ts";

test.each([
  [{ type: "object" }, {}, []],
  [{ type: "object" }, [], ["type"]],
  [{ type: ["string", "null"] }, null, []],
  [{ type: ["string", "null"] }, 2, ["type"]],
  [{ properties: { x: { type: "number" } } }, { x: "a" }, ["type"]],
  [{ required: ["x"] }, {}, ["required"]],
  [{ required: ["x"] }, { x: 1 }, []],
  [{ properties: { x: {} }, additionalProperties: false }, { x: 1, y: 2 }, ["additional"]],
  [{ items: { type: "string" } }, [1], ["type"]],
  [{ items: { type: "string" } }, ["a"], []],
  [{ enum: [1, 2] }, 3, ["enum"]],
  [{ enum: [1, 2] }, 1, []],
  [{ const: { x: 1 } }, { x: 2 }, ["const"]],
  [{ const: { x: 1 } }, { x: 1 }, []],
  [{ minimum: 2 }, 1, ["minimum"]],
  [{ minimum: 2 }, 2, []],
  [{ maximum: 2 }, 3, ["maximum"]],
  [{ maximum: 2 }, 2, []],
  [{ minLength: 2 }, "a", ["minLength"]],
  [{ minLength: 2 }, "ab", []],
  [{ maxLength: 2 }, "abc", ["maxLength"]],
  [{ maxLength: 2 }, "ab", []],
  [{ minItems: 2 }, [1], ["minItems"]],
  [{ minItems: 2 }, [1, 2], []],
  [{ maxItems: 1 }, [1, 2], ["maxItems"]],
  [{ maxItems: 1 }, [1], []],
  [{ type: "integer" }, 1.5, ["type"]],
  [{ type: "boolean" }, true, []],
  [{ type: "number" }, 1, []],
  [{ $schema: "x", $id: "x", title: "t", description: "d" }, null, []],
  [{ type: "string", pattern: "^(a+)+$" }, "a", ["unsupported schema keyword pattern"]],
])("schema %#", (schema, value, errors) => {
  const result = validateJsonSchema(schema, value);
  if (errors.length === 0) expect(result).toEqual([]);
  else for (const error of errors) expect(result.join(" ")).toContain(error);
});
