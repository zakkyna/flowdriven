import { expect, test } from "vitest";
import { createProbes, parsePressure, parsePs, reserveMb } from "./probes.ts";

test("parses the pressure level and the process group's RSS", () => {
  expect(parsePressure("2\n")).toBe(2);
  expect(parsePressure("garbage")).toBeUndefined();
  const ps = "  100  2048\n  100 10240\n  200  5000\n";
  expect(parsePs(ps, 100)).toBe(12);
  expect(parsePs(ps, 300)).toBeUndefined();
  expect(parsePs("100 2048\n100 invalid\n", 100)).toBeUndefined();
});
test("the reserve is the setting, else 15% of installed memory and at least 1 GB", () => {
  expect(reserveMb(500, 16384)).toBe(500);
  expect(reserveMb(null, 16384)).toBe(2458);
  expect(reserveMb(null, 4096)).toBe(1024);
});
test("refresh reads the three values; a failing command leaves one value undefined and never throws", async () => {
  const calls: string[] = [];
  const ok = createProbes({
    platform: "darwin",
    availableMemory: () => 3603 * 1048576,
    totalMemory: () => 16384 * 1048576,
    capture: async (cmd) => {
      calls.push(cmd);
      return cmd.endsWith("sysctl") ? { code: 0, stdout: "4\n" } : { code: 0, stdout: "7 307200\n" };
    },
  });
  await ok.refresh();
  expect([ok.availableMb(), ok.pressureLevel(), ok.groupRssMb(7), ok.totalMb()]).toEqual([
    3603, 4, 300, 16384,
  ]);
  expect(calls).toEqual(["/usr/sbin/sysctl", "/bin/ps"]);
  const bad = createProbes({
    platform: "darwin",
    availableMemory: () => {
      throw new Error("x");
    },
    totalMemory: () => 1048576,
    capture: async () => {
      throw new Error("no ps");
    },
  });
  await bad.refresh();
  expect([bad.availableMb(), bad.pressureLevel(), bad.groupRssMb(7)]).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  const linux = createProbes({
    platform: "linux",
    availableMemory: () => 1048576,
    totalMemory: () => 1048576,
    capture: async () => {
      throw new Error("never");
    },
  });
  await linux.refresh();
  expect(linux.pressureLevel()).toBeUndefined();
});
