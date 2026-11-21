export class EngineError extends Error {
  code: "not_found" | "invalid_input" | "not_allowed" | "unavailable";
  reason?: string;
  constructor(code: EngineError["code"], message: string, reason?: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.reason = reason;
  }
}
