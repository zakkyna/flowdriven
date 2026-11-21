import { AuditRecord, type OperationInput } from "@flowdriven/contracts";
import type { Store } from "../storage.ts";

function detailOf(value: unknown): Record<string, string | number | boolean | null | string[]> {
  const result: Record<string, string | number | boolean | null | string[]> = {};
  const visit = (value: unknown, key: string) => {
    if (
      /^(?:message|text|body|prompt|payload|input|output|path|address|value)$/i.test(
        key.split(".").at(-1) ?? "",
      )
    )
      return;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      result[key] = value;
    else if (Array.isArray(value)) {
      if (value.every((item) => typeof item === "string")) result[key] = value;
    } else if (typeof value === "object")
      for (const [part, child] of Object.entries(value)) visit(child, key ? `${key}.${part}` : part);
  };
  if (value && typeof value === "object" && !Array.isArray(value)) visit(value, "");
  return result;
}
export function createAuditHandler(store: Store) {
  return (input: OperationInput<"audit.list">) =>
    store.listAuditRecords(input).map((row) => AuditRecord.parse({ ...row, detail: detailOf(row.detail) }));
}
