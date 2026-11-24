import { z } from "zod";
import { AgentId, Id, IsoDateTime } from "./common.ts";
export const Skill = z.strictObject({
  id: Id,
  name: z.string(),
  about: z.string(),
  origin: z.enum(["agent", "flowdriven", "library"]),
  agentId: AgentId.optional(),
  usedBy: z.array(z.strictObject({ flowId: Id, name: z.string() })),
  lastUsedAt: IsoDateTime.optional(),
  readable: z.boolean(),
  problem: z.enum(["hidden_characters", "invalid_skill_file", "too_large"]).optional(),
});
export type Skill = z.infer<typeof Skill>;
export const SkillIdInput = z.strictObject({ skillId: Id });
export type SkillIdInput = z.infer<typeof SkillIdInput>;
