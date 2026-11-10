import { createFixtureRunnerClient } from "@flowdriven/fixtures";
import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { RunnerProvider, useRunnerQuery } from "./runner-context";

function Count() {
  const { data } = useRunnerQuery("approvals.list", { state: "pending" });
  return <p>{data ? `${data.length} waiting` : "loading"}</p>;
}
function Missing() {
  const { error } = useRunnerQuery("runs.status", { runId: "run-9999" });
  return <p>{error?.code ?? "none"}</p>;
}
function Skipped() {
  const { data, error, loading } = useRunnerQuery("runs.status", { runId: "run-0001" }, { skip: true });
  return <p>{loading ? "loading" : data === undefined && error === undefined ? "skipped" : "ran"}</p>;
}

test("queries refresh when the runner reports a change", async () => {
  const client = createFixtureRunnerClient();
  render(
    <RunnerProvider client={client}>
      <Count />
      <Missing />
    </RunnerProvider>,
  );
  expect(await screen.findByText("5 waiting")).toBeTruthy();
  expect(await screen.findByText("not_found")).toBeTruthy();
  await act(() => client.call("approvals.resolve", { approvalId: "ap-0014", decision: "approve" }));
  expect(await screen.findByText("4 waiting")).toBeTruthy();
});

test("a skipped query makes no call and is not loading", async () => {
  const client = createFixtureRunnerClient();
  const call = vi.spyOn(client, "call");
  render(
    <RunnerProvider client={client}>
      <Skipped />
    </RunnerProvider>,
  );
  expect(await screen.findByText("skipped")).toBeTruthy();
  expect(call.mock.calls.filter(([name]) => name === "runs.status")).toHaveLength(0);
});
