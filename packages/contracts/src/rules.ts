import { z } from "zod";
import { Id } from "./common.ts";

export const RulesListInput = z.strictObject({ flowId: Id.optional() });
export type RulesListInput = z.infer<typeof RulesListInput>;
export const RulesRevokeInput = z.strictObject({ ruleId: Id });
export type RulesRevokeInput = z.infer<typeof RulesRevokeInput>;
