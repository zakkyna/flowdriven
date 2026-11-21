import { expect, test } from "vitest";
import * as common from "./common.ts";

test("TC-CON-10 shared primitives", () => {
  for (const value of ["local.fill-timesheet", "chain:abc:1", "run-000000000001", ":legacy", "a".repeat(100)])
    expect(common.Id.safeParse(value).success).toBe(true);
  for (const value of ["", " a", "a b", "../x", "a".repeat(101)])
    expect(common.Id.safeParse(value).success).toBe(false);
  for (const value of ["opus-5.5", "gpt-6.1-terra", "gpt-6-luna", "a".repeat(64)])
    expect(common.ModelId.safeParse(value).success).toBe(true);
  for (const value of ["-opus", "opus 5.5", "Opus-5.5", "5opus", "a;b", "a".repeat(65)])
    expect(common.ModelId.safeParse(value).success).toBe(false);
  for (const value of ["claude-code", "codex"]) expect(common.AgentId.safeParse(value).success).toBe(true);
  for (const value of ["Codex", "codex_1", "a".repeat(33)])
    expect(common.AgentId.safeParse(value).success).toBe(false);
  for (const value of ["log-hours", "submit", "1-touch"])
    expect(common.TouchId.safeParse(value).success).toBe(true);
  for (const value of ["-x", "A", "a".repeat(65)])
    expect(common.TouchId.safeParse(value).success).toBe(false);
  for (const value of ["en", "id", "pt-BR", "fil"])
    expect(common.LanguageCode.safeParse(value).success).toBe(true);
  for (const value of ["EN", "english", "en_US"])
    expect(common.LanguageCode.safeParse(value).success).toBe(false);
  expect(common.ContentHash.safeParse(`sha256:${"a".repeat(64)}`).success).toBe(true);
  for (const value of [`sha256:${"a".repeat(63)}`, `sha256:${"A".repeat(64)}`, "md5:abc"])
    expect(common.ContentHash.safeParse(value).success).toBe(false);
});
test("TC-CON-11 Line and Place", () => {
  for (const line of [
    { key: "report.youSaidNo", params: { title: "Log 8 hours?" } },
    { key: "chat.itsTime", params: { time: "17:00", flow: "Fill timesheet" } },
    { key: "a.b", params: { v: "x".repeat(400) } },
  ])
    expect(common.Line.safeParse(line).success).toBe(true);
  for (const line of [
    { key: "report" },
    { key: "Report.x" },
    { key: `a.${"b".repeat(99)}` },
    { key: "a.b", params: { v: "x".repeat(401) } },
    { key: "a.b", params: { v: {} } },
  ])
    expect(common.Line.safeParse(line).success).toBe(false);
  const place = { kind: "account", value: "timesheet-account", label: "Timesheet account" };
  expect(common.Place.safeParse(place).success).toBe(true);
  for (const bad of [
    { ...place, kind: "email" },
    { ...place, extra: true },
    { ...place, value: "" },
    { ...place, value: "x".repeat(601) },
    { ...place, label: "x".repeat(201) },
  ])
    expect(common.Place.safeParse(bad).success).toBe(false);
});
