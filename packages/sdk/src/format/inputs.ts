import "../config.ts";
import { z } from "zod";
import { valueId } from "./steps.ts";

export const InputDeclV12 = z
  .strictObject({
    id: valueId,
    type: z.enum([
      "text",
      "number",
      "bool",
      "enum",
      "date",
      "url",
      "file",
      "folder",
      "secret_ref",
      "list<text>",
      "time",
      "duration",
      "longtext",
      "choice",
    ]),
    label: z.string(),
    required: z.boolean().default(false),
    default: z.unknown().optional(),
    example: z.string().max(200).optional(),
    remember: z.boolean().default(false),
    choices: z
      .array(z.strictObject({ key: valueId, label: z.string() }))
      .min(1)
      .max(50)
      .optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .superRefine((input, ctx) => {
    const error = (path: string, message: string, code?: string) =>
      ctx.addIssue({ code: "custom", path: [path], message, ...(code ? { params: { code } } : {}) });
    if (input.remember && (input.type === "date" || input.type === "time"))
      error("remember", "Dates and times cannot be remembered", "remember_date_time");
    if (input.type === "choice" || input.type === "enum") {
      if (!input.choices || new Set(input.choices.map((choice) => choice.key)).size !== input.choices.length)
        error("choices", "Choices must have unique keys");
    } else if (input.choices !== undefined) error("choices", "Choices are only for choice inputs");
    if ((input.min !== undefined || input.max !== undefined) && input.type !== "number")
      error("min", "Bounds are only for number inputs");
    if (input.min !== undefined && input.max !== undefined && input.min > input.max)
      error("min", "Minimum exceeds maximum");
    const value = input.default;
    if (value === undefined) return;
    let valid: boolean;
    switch (input.type) {
      case "number":
        valid =
          typeof value === "number" &&
          Number.isFinite(value) &&
          (input.min === undefined || value >= input.min) &&
          (input.max === undefined || value <= input.max);
        break;
      case "duration":
        valid = typeof value === "number" && Number.isFinite(value);
        break;
      case "bool":
        valid = typeof value === "boolean";
        break;
      case "date":
        valid = value === "today" || z.iso.date().safeParse(value).success;
        break;
      case "time":
        valid = value === "now" || (typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
        break;
      case "choice":
      case "enum":
        valid = input.choices?.some((choice) => choice.key === value) ?? false;
        break;
      case "list<text>":
        valid = Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
        break;
      default:
        valid = typeof value === "string";
    }
    if (!valid) error("default", "Default does not match input type");
  })
  .transform((input) => ({ ...input, type: input.type === "enum" ? ("choice" as const) : input.type }));

export type InputDeclV12 = z.infer<typeof InputDeclV12>;
export function defaultKind(input: InputDeclV12): "value" | "today" | "now" {
  if (input.type === "date" && input.default === "today") return "today";
  if (input.type === "time" && input.default === "now") return "now";
  return "value";
}
