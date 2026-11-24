import { RunState } from "@flowdriven/contracts/v1";
import { type ReactElement, useState } from "react";
import { useRunnerQuery } from "../../legacy/runner-context";
import { Button } from "../../ui/Button";
import { Page } from "../../ui/Page";
import { ScreenState } from "../../ui/ScreenState";
import { statusOf } from "../../ui/status";
import { QueuePanel } from "./QueuePanel";
import styles from "./Runs.module.css";
import { RunsTable } from "./RunsTable";

const description = "Every run of every flow, newest first.";
const filters = { flow: "", project: "", state: "" };
export function RunsScreen(): ReactElement {
  const runs = useRunnerQuery("runs.list", {});
  const flows = useRunnerQuery("flows.list", {});
  const [flow, setFlowValue] = useState(filters.flow);
  const [project, setProjectValue] = useState(filters.project);
  const [state, setStateValue] = useState(filters.state);
  const setFlow = (value: string) => {
    filters.flow = value;
    setFlowValue(value);
  };
  const setProject = (value: string) => {
    filters.project = value;
    setProjectValue(value);
  };
  const setState = (value: string) => {
    filters.state = value;
    setStateValue(value);
  };
  const loading = runs.loading || flows.loading;
  const error = runs.error ?? flows.error;
  if (loading || error)
    return (
      <ScreenState
        screen="runs"
        title="Runs"
        description={description}
        loading={loading}
        error={error}
        reload={() => {
          runs.reload();
          flows.reload();
        }}
      />
    );
  const all = [...(runs.data ?? [])].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const oneTime = all.filter(
    (run, index) =>
      run.oneTime &&
      !flows.data?.some((item) => item.id === run.flowId) &&
      all.findIndex((item) => item.oneTime && item.flowId === run.flowId) === index,
  );
  const filtered = all.filter(
    (run) =>
      (!flow || run.flowId === flow) &&
      (!project || run.project === project) &&
      (!state || run.state === state),
  );
  return (
    <Page screen="runs" ready size="wide" title="Runs" description={description}>
      <QueuePanel />
      <div className={styles.filters}>
        <label>
          Flow
          <select value={flow} onChange={(event) => setFlow(event.target.value)}>
            <option value="">All flows</option>
            {flows.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            {oneTime.map((item) => (
              <option key={item.flowId} value={item.flowId}>
                {item.flowName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select value={project} onChange={(event) => setProject(event.target.value)}>
            <option value="">All projects</option>
            {[...new Set(all.map((item) => item.project))].sort().map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          State
          <select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">All states</option>
            {RunState.options.map((item) => (
              <option key={item} value={item}>
                {statusOf("run", item).label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!all.length ? (
        <div>
          <h2>No runs yet.</h2>
          <p>Run a flow from the Builder, or ask for one-off work in chat.</p>
        </div>
      ) : !filtered.length ? (
        <div>
          <p>No runs match these filters.</p>
          <Button
            onClick={() => {
              setFlow("");
              setProject("");
              setState("");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <RunsTable runs={filtered} />
      )}
    </Page>
  );
}
