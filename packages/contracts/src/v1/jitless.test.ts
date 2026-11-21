import { expect, test, vi } from "vitest";
import { z } from "zod";
import "./index";

test("contracts disable Zod JIT and construct parsers without Function", () => {
  expect(z.config().jitless).toBe(true);
  const functionSpy = vi.spyOn(globalThis, "Function");
  try {
    z.object({ value: z.string() }).parse({ value: "ok" });
    expect(functionSpy).not.toHaveBeenCalled();
  } finally {
    functionSpy.mockRestore();
  }
});
