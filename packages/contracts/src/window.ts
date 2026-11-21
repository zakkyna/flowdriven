import { z } from "zod";
export const WINDOW_CALLS = ["getPrefs", "setColorMode", "openLink", "quit"] as const;
export const ColorMode = z.enum(["light", "system", "dark"]);
export type ColorMode = z.infer<typeof ColorMode>;
export const SetColorModeInput = ColorMode;
export type SetColorModeInput = z.infer<typeof SetColorModeInput>;
export const OpenLinkInput = z.string().max(2048);
export type OpenLinkInput = z.infer<typeof OpenLinkInput>;
export const WindowPrefs = z.strictObject({
  colorMode: ColorMode,
  platform: z.enum(["darwin", "win32", "linux"]),
});
export type WindowPrefs = z.infer<typeof WindowPrefs>;
export function WindowReply<T extends z.ZodType>(schema: T) {
  return z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), result: schema }),
    z.strictObject({
      ok: z.literal(false),
      error: z.strictObject({
        code: z.enum(["not_allowed", "invalid_input", "unavailable"]),
        message: z.string(),
      }),
    }),
  ]);
}
export type WindowReply<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: "not_allowed" | "invalid_input" | "unavailable"; message: string } };
