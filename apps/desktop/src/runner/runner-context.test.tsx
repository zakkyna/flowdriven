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
  const { data, error, loading } = useRunnerQuery("runs.status", { runId: "run-apk-done" }, { skip: true });
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
  expect(await screen.findByText("1 waiting")).toBeTruthy();
  expect(await screen.findByText("not_found")).toBeTruthy();
  await act(() => client.call("approvals.resolve", { approvalId: "decision-1", decision: "approve" }));
  expect(await screen.findByText("0 waiting")).toBeTruthy();
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

function RetryQuery() {
  const { error, loading, reload } = useRunnerQuery("approvals.list", { state: "pending" });
  return (
    <>
      <p>{loading ? "loading" : error ? error.message : "done"}</p>
      <button type="button" onClick={reload}>
        Reload
      </button>
    </>
  );
}

test("retry after an error displays loading until the response", async () => {
  const client = createFixtureRunnerClient();
  vi.spyOn(client, "call")
    .mockRejectedValueOnce(new Error("failed"))
    .mockImplementationOnce(() => new Promise(() => {}));
  render(
    <RunnerProvider client={client}>
      <RetryQuery />
    </RunnerProvider>,
  );
  expect(await screen.findByText("failed")).toBeTruthy();
  await act(() => screen.getByText("Reload").click());
  expect(screen.getByText("loading")).toBeTruthy();
});

test("a synchronous client error becomes a query error", async () => {
  const client = createFixtureRunnerClient();
  vi.spyOn(client, "call").mockImplementation(() => {
    throw new Error("synchronous failure");
  });
  render(
    <RunnerProvider client={client}>
      <RetryQuery />
    </RunnerProvider>,
  );
  expect(await screen.findByText("synchronous failure")).toBeTruthy();
});
