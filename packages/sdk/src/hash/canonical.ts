import { createHash } from "node:crypto";
export type FlowFiles = ReadonlyMap<string, Uint8Array>;
export class FlowFileError extends Error {
  code: "invalid_path" | "symlink" | "too_large" | "missing_file" | "yaml";
  constructor(code: FlowFileError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function canonicalListing(files: FlowFiles): string {
  const rows = [...files].map(([path, bytes]) => {
    if (
      !(path as unknown as { isWellFormed(): boolean }).isWellFormed() ||
      path.length === 0 ||
      path.length > 512 ||
      path.startsWith("/") ||
      /[\\\t\r\n]/.test(path) ||
      path.split("/").some((part) => part === "" || part === "." || part === "..")
    )
      throw new FlowFileError("invalid_path", `Invalid path: ${path}`);
    return { key: Buffer.from(path, "utf8"), line: `${path}\t${sha256Hex(bytes)}\n` };
  });
  rows.sort((a, b) => Buffer.compare(a.key, b.key));
  return rows.map((row) => row.line).join("");
}
export function contentHash(files: FlowFiles): `sha256:${string}` {
  return `sha256:${sha256Hex(Buffer.from(canonicalListing(files), "utf8"))}`;
}
