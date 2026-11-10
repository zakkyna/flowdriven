import { expect, test } from "vitest";
import { CONTENT_SECURITY_POLICY } from "./csp";

test("the policy allows only the app's own files", () => {
  expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
  expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
});
