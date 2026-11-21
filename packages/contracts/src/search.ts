import { z } from "zod";
import { Id, IsoDateTime } from "./common.ts";

const chat = z.strictObject({
  chatId: Id,
  title: z.string(),
  updatedAt: IsoDateTime,
  snippet: z.string().optional(),
  outside: z.boolean(),
});
const flow = z.strictObject({ flowId: Id, name: z.string(), summary: z.string() });
export const SearchResult = z
  .strictObject({ recent: z.boolean(), chats: z.array(chat), flows: z.array(flow) })
  .refine(
    (result) =>
      result.chats.length <= (result.recent ? 5 : 20) && result.flows.length <= (result.recent ? 200 : 50),
  );
export type SearchResult = z.infer<typeof SearchResult>;
