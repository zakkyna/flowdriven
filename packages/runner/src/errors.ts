export class EngineError extends Error {
  code: "not_found" | "invalid_input" | "not_allowed" | "unavailable" | "conflict";
  reason?: string;
  params?: Record<string, string | number | string[]>;
  constructor(
    code: EngineError["code"],
    message: string,
    detail?: string | { reason?: string; params?: Record<string, string | number | string[]> },
  ) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.reason = typeof detail === "string" ? detail : detail?.reason;
    this.params = typeof detail === "object" ? detail.params : undefined;
  }
}
