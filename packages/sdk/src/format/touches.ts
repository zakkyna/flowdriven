import "../config.ts";
import { z } from "zod";

export const Touch = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  sentence: z.string().min(1).max(200),
  effect: z.enum(["read", "local_write", "run_command", "change", "send", "post", "pay", "delete", "merge"]),
  place: z
    .strictObject({
      kind: z.enum(["account", "folder", "address", "site", "command", "repo"]),
      value: z.string().min(1),
      label: z.string().min(1),
    })
    .optional(),
  rule: z.enum(["runs_alone", "asks_first", "not_allowed"]),
  covers: z.array(z.string().min(1)).default([]),
});
export type Touch = z.infer<typeof Touch>;
export const Touches = z
  .array(Touch)
  .max(100)
  .superRefine((touches, ctx) => {
    const ids = new Set<string>();
    touches.forEach((touch, i) => {
      if (ids.has(touch.id))
        ctx.addIssue({
          code: "custom",
          path: [i, "id"],
          message: "Duplicate touch",
          params: { code: "touch_duplicate" },
        });
      ids.add(touch.id);
    });
  });
