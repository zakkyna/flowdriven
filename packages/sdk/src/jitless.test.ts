import "./index.ts";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { parseManifest } from "./index.ts";
import { upworkJobReview } from "./test-data/upwork.ts";

test("the SDK disables Zod JIT and parses without Function", () => {
  expect(z.config().jitless).toBe(true);
  const spy = vi.spyOn(globalThis, "Function");
  try {
    expect(parseManifest(upworkJobReview).ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});
