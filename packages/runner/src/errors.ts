export class EngineError extends Error {
  code: "not_found" | "invalid_input" | "not_allowed" | "unavailable";
  constructor(code: EngineError["code"], message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}
