import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isInside, resolveDeep } from "../claude/paths.ts";

export const EXTRA_REF = /^~\/[^/]+(?:\/[^/]+)*$/;
export const FOLDER_REASON = {
  form: "A granted folder is written ~/ and a folder name, with no hidden or parent parts.",
  outsideHome: "This folder is not inside your home folder.",
  wide: "This folder holds your whole home folder; grant a smaller one.",
  hidden: "This folder is a hidden folder or inside one.",
  library: "FlowDriven does not grant folders inside ~/Library.",
  own: "This folder holds FlowDriven's own data, or is inside it.",
} as const;
export function isExtraRef(ref: string | undefined): boolean {
  // Control, format (zero-width, bidi) and separator characters and backslashes are refused.
  if (!ref || !EXTRA_REF.test(ref) || /[\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ref)) return false;
  const parts = ref.slice(2).split("/");
  return parts.length <= 16 && parts.every((part) => !part.startsWith("."));
}
const fold = (path: string) => path.normalize("NFC").toLowerCase();
export function resolveExtraFolder(
  ref: string,
  o: { home: string; dataDir: string },
): { ok: true; path: string; exists: boolean } | { ok: false; reason: string } {
  if (!isExtraRef(ref)) return { ok: false, reason: FOLDER_REASON.form };
  const home = resolveDeep(o.home);
  const path = home && resolveDeep(join(home, ref.slice(2)));
  const dataDir = resolveDeep(o.dataDir);
  if (!home || !path || !dataDir) return { ok: false, reason: FOLDER_REASON.outsideHome };
  const h = fold(home),
    p = fold(path),
    d = fold(dataDir);
  if (!isInside(h, p)) return { ok: false, reason: FOLDER_REASON.outsideHome };
  if (h === p) return { ok: false, reason: FOLDER_REASON.wide };
  if (
    relative(h, p)
      .split(sep)
      .some((part) => part.startsWith("."))
  )
    return { ok: false, reason: FOLDER_REASON.hidden };
  if (isInside(join(h, "library"), p)) return { ok: false, reason: FOLDER_REASON.library };
  if (isInside(d, p) || isInside(p, d)) return { ok: false, reason: FOLDER_REASON.own };
  return { ok: true, path, exists: existsSync(path) };
}
