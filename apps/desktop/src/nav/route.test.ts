import { expect, test } from "vitest";
import { parseRoute, type Route, routeToHash } from "./route";

test("#/builder/new is the new-flow state and round-trips", () => {
  expect(parseRoute("#/builder/new")).toEqual({ screen: "builder", isNew: true });
  expect(routeToHash({ screen: "builder", isNew: true })).toBe("#/builder/new");
  expect(parseRoute(routeToHash({ screen: "builder", isNew: true }))).toEqual({
    screen: "builder",
    isNew: true,
  });
  expect(parseRoute("#/builder/new/extra")).toEqual({ screen: "not_found", hash: "#/builder/new/extra" });
  expect(parseRoute("#/readiness/new")).toEqual({ screen: "readiness", flowId: "new" });
});

test("parses every screen", () => {
  expect(parseRoute("")).toEqual({ screen: "builder" });
  expect(parseRoute("#/")).toEqual({ screen: "builder" });
  expect(parseRoute("#/builder/dev.example.figma-to-flutter")).toEqual({
    screen: "builder",
    flowId: "dev.example.figma-to-flutter",
  });
  expect(parseRoute("#/inbox/ap-0011")).toEqual({ screen: "inbox", approvalId: "ap-0011" });
  expect(parseRoute("#/runs")).toEqual({ screen: "runs" });
  expect(parseRoute("#/runs/run-0006")).toEqual({ screen: "run", runId: "run-0006" });
  expect(parseRoute("#/readiness/dev.example.social-posts")).toEqual({
    screen: "readiness",
    flowId: "dev.example.social-posts",
  });
  expect(parseRoute("#/harnesses")).toEqual({ screen: "harnesses" });
  expect(parseRoute("#/settings")).toEqual({ screen: "settings" });
  expect(parseRoute("#/settings/extra")).toEqual({ screen: "not_found", hash: "#/settings/extra" });
  expect(parseRoute("#/runs/a%20b")).toEqual({ screen: "run", runId: "a b" });
});
test("round-trips", () => {
  const routes: Route[] = [
    { screen: "builder", flowId: "x.y" },
    { screen: "inbox" },
    { screen: "run", runId: "run-0006" },
    { screen: "settings" },
  ];
  for (const r of routes) expect(parseRoute(routeToHash(r))).toEqual(r);
});

test("TC-UI-30 parses and round-trips the nine new routes while keeping old routes parseable", () => {
  const newCases: [string, Route][] = [
    ["#/chat", { screen: "chat" }],
    ["#/chat/chat-1", { screen: "chat", chatId: "chat-1" }],
    ["#/flows", { screen: "flows" }],
    ["#/flows/example.fill-timesheet", { screen: "flow", flowId: "example.fill-timesheet" }],
    ["#/activity", { screen: "activity" }],
    ["#/activity/run-1", { screen: "activity_run", runId: "run-1" }],
    ["#/skills", { screen: "skills" }],
    ["#/settings", { screen: "settings" }],
    ["#/welcome", { screen: "welcome" }],
  ];
  for (const [hash, expected] of newCases) {
    expect(parseRoute(hash), hash).toEqual(expected);
    expect(routeToHash(expected), hash).toBe(hash);
    expect(parseRoute(routeToHash(expected)), hash).toEqual(expected);
  }

  const encodedCases: [string, Route][] = [
    ["#/chat/a%20b", { screen: "chat", chatId: "a b" }],
    ["#/flows/a%20b", { screen: "flow", flowId: "a b" }],
    ["#/activity/a%20b", { screen: "activity_run", runId: "a b" }],
  ];
  for (const [hash, expected] of encodedCases) {
    expect(parseRoute(hash), hash).toEqual(expected);
    expect(routeToHash(expected), hash).toBe(hash);
  }

  for (const unknown of [
    "#/nowhere",
    "#/skills/extra",
    "#/welcome/extra",
    "#/chat/chat-1/extra",
    "#/flows/a/extra",
    "#/activity/a/extra",
    "#/chat/",
    "#/flows/",
    "#/activity/",
  ]) {
    expect(parseRoute(unknown), unknown).toEqual({ screen: "not_found", hash: unknown });
  }

  const oldCases: [string, Route][] = [
    ["#/builder", { screen: "builder" }],
    ["#/inbox", { screen: "inbox" }],
    ["#/runs", { screen: "runs" }],
    ["#/runs/run-0006", { screen: "run", runId: "run-0006" }],
    ["#/harnesses", { screen: "harnesses" }],
    ["#/readiness/example.fill-timesheet", { screen: "readiness", flowId: "example.fill-timesheet" }],
  ];
  for (const [hash, expected] of oldCases) {
    expect(parseRoute(hash), hash).toEqual(expected);
    expect(routeToHash(expected), hash).toBe(hash);
  }
});
