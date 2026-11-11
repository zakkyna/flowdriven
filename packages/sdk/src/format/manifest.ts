import "../config.ts";
import { z } from "zod";
import { FORMAT_ID } from "../vocab.ts";
import { Requirement } from "./requirements.ts";
import { Duration, durationMs, Limits, OutputDecl, Step, valueId } from "./steps.ts";
export const Trigger = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("manual") }),
  z
    .strictObject({
      kind: z.literal("schedule"),
      every: Duration.optional(),
      at: z
        .string()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
      days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).optional(),
      catch_up: z.enum(["none", "once"]).default("none"),
      overlap: z.enum(["skip", "queue"]).default("skip"),
    })
    .refine((v) => (v.every !== undefined) !== (v.at !== undefined)),
  z.strictObject({
    kind: z.literal("new_item"),
    source: z.string(),
    query: z.string(),
    every: Duration.refine((s) => {
      try {
        return durationMs(s) >= 300000;
      } catch {
        return false;
      }
    }),
    key: z.string(),
    max_items: z.number().int().positive().optional(),
  }),
  z.strictObject({
    kind: z.literal("file_change"),
    path: z.string(),
    glob: z.string().default("**/*"),
    debounce: Duration.default("10s"),
  }),
  z.strictObject({ kind: z.literal("link"), inputs: z.array(z.string()).default([]) }),
  z.strictObject({ kind: z.literal("webhook"), schema: z.string() }),
  z.strictObject({
    kind: z.literal("flow_done"),
    flow: z.string(),
    status: z.enum(["done", "any"]).default("done"),
  }),
]);
export type Trigger = z.infer<typeof Trigger>;
export const InputDecl = z.strictObject({
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
  ]),
  label: z.string(),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  remember: z.boolean().optional(),
});
export type InputDecl = z.infer<typeof InputDecl>;
export const ParamDecl = z.strictObject({
  type: z.enum(["number", "text", "bool", "enum"]),
  default: z.unknown().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string()).optional(),
  label: z.string().optional(),
});
export type ParamDecl = z.infer<typeof ParamDecl>;
export const FlowManifest = z.strictObject({
  format: z.literal(FORMAT_ID),
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
  name: z.string(),
  summary: z.string().default(""),
  description: z.string().default(""),
  version: z.string().default("0.1.0"),
  publisher: z.string().optional(),
  license: z.string().default("UNLICENSED"),
  kind: z.enum(["build", "light"]),
  inputs: z.array(InputDecl).default([]),
  outputs: z.array(OutputDecl).default([]),
  requirements: z.array(Requirement).default([]),
  defaults: z
    .strictObject({
      worker: z.string().optional(),
      skills: z.array(z.string()).optional(),
      connectors: z.array(z.string()).optional(),
    })
    .default({}),
  params: z.record(valueId, ParamDecl).default({}),
  triggers: z.array(Trigger).default([]),
  limits: Limits.optional(),
  approvals: z.strictObject({ extra_risky: z.array(z.string()).default([]) }).default({ extra_risky: [] }),
  memory: z.array(z.string()).default([]),
  steps: z.array(Step).min(1),
});
export type FlowManifest = z.infer<typeof FlowManifest>;
