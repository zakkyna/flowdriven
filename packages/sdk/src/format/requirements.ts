import "../config.ts";
import { z } from "zod";

export const requirementId = z.string().regex(/^[a-z][a-z0-9_-]*$/);
const common = {
  id: requirementId,
  ref: z.string().optional(),
  required: z.boolean().default(true),
  sensitive: z.boolean().default(false),
  why: z.string().default(""),
  routes: z
    .array(
      z.strictObject({
        via: z.string(),
        risk: z.enum(["official", "gray", "unofficial"]),
        note: z.string().optional(),
      }),
    )
    .optional(),
};
const connected = {
  connect: z.enum(["native", "gateway"]).optional(),
  tools: z.array(z.string()).optional(),
};
export const Requirement = z.discriminatedUnion("type", [
  z.strictObject({ ...common, type: z.literal("harness") }),
  z.strictObject({ ...common, type: z.literal("skill"), ...connected }),
  z.strictObject({ ...common, type: z.literal("plugin"), ...connected, tools: z.array(z.string()).min(1) }),
  z.strictObject({
    ...common,
    type: z.literal("mcp_server"),
    ...connected,
    tools: z.array(z.string()).min(1),
  }),
  z.strictObject({
    ...common,
    type: z.literal("cli_tool"),
    commands: z.array(z.string().regex(/^[A-Za-z0-9._-]+(?: [^\s*]+)*(?: \*)?$/)).optional(),
  }),
  z.strictObject({ ...common, type: z.literal("gui_app") }),
  z.strictObject({ ...common, type: z.literal("account") }),
  z.strictObject({ ...common, type: z.literal("browser_session"), domains: z.array(z.string()).optional() }),
  z.strictObject({
    ...common,
    type: z.literal("path"),
    access: z.enum(["read", "read_write"]).default("read"),
  }),
  z.strictObject({
    ...common,
    type: z.literal("web"),
    mode: z.enum(["read", "act"]),
    session: z.enum(["none", "managed", "own"]).default("managed"),
    domains: z.array(z.string()).optional(),
    url_patterns: z.array(z.string()).optional(),
    rate: z
      .strictObject({
        per_run: z.number().int().positive().optional(),
        per_day: z.number().int().positive().optional(),
      })
      .optional(),
    on_challenge: z.literal("stop").default("stop"),
  }),
  z.strictObject({
    ...common,
    type: z.literal("desktop"),
    mode: z.enum(["open", "read", "act"]),
    apps: z.array(z.string()).default([]),
    actions: z.array(z.string()).default([]),
  }),
  z.strictObject({
    ...common,
    type: z.literal("trigger"),
    kinds: z.array(z.string()).default([]),
    provider: z.enum(["runner", "harness"]).default("runner"),
  }),
]);
export type Requirement = z.infer<typeof Requirement>;
