import { attentionCount, isReady, type ReadinessItem, type RunnerError } from "@flowdriven/contracts";
import { type ReactElement, useEffect, useState } from "react";
import { NotFoundPage } from "../../nav/NotFoundPage";
import { useRoute } from "../../nav/route";
import { useRunnerAction, useRunnerQuery } from "../../runner/runner-context";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { formatDateTime } from "../../ui/format";
import { Icon } from "../../ui/icons";
import { Page } from "../../ui/Page";
import { ScreenState } from "../../ui/ScreenState";
import styles from "./Readiness.module.css";
import { ReadinessRow } from "./ReadinessRow";

const description = "Everything a flow needs, checked before every run.";
export function ReadinessScreen({ flowId }: { flowId?: string }): ReactElement {
  const flows = useRunnerQuery("flows.list", {});
  const action = useRunnerAction();
  const [, navigate] = useRoute();
  const [selected, setSelected] = useState<string>();
  const [selectionError, setSelectionError] = useState<RunnerError>();
  const [installing, setInstalling] = useState<ReadinessItem>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [actionError, setActionError] = useState("");
  const effectiveId = flowId ?? selected;
  const report = useRunnerQuery("readiness.check", { flowId: effectiveId ?? "" }, { skip: !effectiveId });
  useEffect(() => {
    if (flowId || !flows.data || flows.data.length === 0) return;
    let active = true;
    setSelected(undefined);
    setSelectionError(undefined);
    const choose = async () => {
      for (const flow of flows.data ?? []) {
        const result = await action("readiness.check", { flowId: flow.id });
        if (!active) return;
        if (!result.ok) {
          setSelectionError(result.error);
          return;
        }
        if (!isReady(result.data.items)) {
          setSelected(flow.id);
          return;
        }
      }
      if (active) setSelected(flows.data?.[0]?.id);
    };
    void choose();
    return () => {
      active = false;
    };
  }, [flowId, flows.data, action]);
  const loading =
    flows.loading || report.loading || (!flowId && !!flows.data?.length && !selected && !selectionError);
  const error = flows.error ?? selectionError ?? report.error;
  const reload = () => {
    flows.reload();
    report.reload();
  };
  if (!loading && report.error?.code === "not_found" && effectiveId)
    return (
      <NotFoundPage
        screen="readiness"
        title="Flow not found"
        text={`There is no flow ${effectiveId} on this Mac.`}
        linkLabel="Go to Readiness"
        to={{ screen: "readiness" }}
      />
    );
  if (loading || error)
    return (
      <ScreenState
        screen="readiness"
        title="Readiness"
        description={description}
        loading={loading}
        error={error}
        reload={reload}
      />
    );
  const data = report.data;
  const count = data ? attentionCount(data.items) : 0;
  const install = async () => {
    if (!installing || !effectiveId) return;
    setBusy(true);
    const result = await action("readiness.install", {
      flowId: effectiveId,
      requirementId: installing.requirementId,
    });
    setBusy(false);
    if (result.ok) {
      setStatus(`Marked ${installing.name} as OK. Sample data: nothing was installed.`);
      setActionError("");
      setInstalling(undefined);
      report.reload();
    } else {
      setActionError(result.error.message);
      setInstalling(undefined);
    }
  };
  return (
    <Page screen="readiness" ready title="Readiness" description={description}>
      {!data ? (
        <div>
          <h2>No flows to check yet.</h2>
          <p>Readiness checks a flow's requirements once you have a flow.</p>
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <label>
              Flow{" "}
              <select
                value={effectiveId}
                onChange={(event) => {
                  setStatus("");
                  setActionError("");
                  navigate({ screen: "readiness", flowId: event.target.value });
                }}
              >
                {flows.data?.map((flow) => (
                  <option key={flow.id} value={flow.id}>
                    {flow.name}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={report.reload}>Check again</Button>
            <span className={styles.small}>Last checked {formatDateTime(data.checkedAt)}</span>
          </div>
          <div className={`${styles.banner} ${isReady(data.items) ? styles.ready : styles.attention}`}>
            <Icon name={isReady(data.items) ? "check" : "hand"} />
            {isReady(data.items)
              ? "Ready to run. Every required item is OK."
              : `Not ready. ${count} required ${count === 1 ? "item needs" : "items need"} attention.`}
          </div>
          {status && <p role="status">{status}</p>}
          {actionError && (
            <p role="alert" className={styles.error}>
              {actionError}
            </p>
          )}
          <ul className={styles.list}>
            {data.items.map((item) => (
              <ReadinessRow
                key={`${data.flowId}-${item.requirementId}`}
                item={item}
                onInstall={() => setInstalling(item)}
                onCheck={report.reload}
              />
            ))}
          </ul>
        </>
      )}
      {installing && (
        <Dialog
          title={`Install ${installing.name}?`}
          confirmLabel="Install"
          confirmDisabled={busy}
          onCancel={() => setInstalling(undefined)}
          onConfirm={() => void install()}
        >
          <p>FlowDriven will run this command:</p>
          <pre className={styles.mono}>{installing.installCommand}</pre>
          <p>It comes from FlowDriven's built-in catalog.</p>
        </Dialog>
      )}
    </Page>
  );
}
