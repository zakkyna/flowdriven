import { expect, test } from "vitest";
import { withTimeZone } from "./time-zone.ts";

test("restores the zone after an async callback fails", async () => {
  const before = process.env.TZ;
  await expect(
    withTimeZone("Asia/Bangkok", async () => {
      await Promise.resolve();
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Bangkok");
      throw new Error("failure");
    }),
  ).rejects.toThrow("failure");
  expect(process.env.TZ).toBe(before);
});

test("restores an unset zone", async () => {
  const before = process.env.TZ;
  delete process.env.TZ;
  try {
    await withTimeZone("UTC", () => expect(process.env.TZ).toBe("UTC"));
    expect(process.env.TZ).toBeUndefined();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
