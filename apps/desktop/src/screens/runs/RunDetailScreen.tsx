import { firstUnpassedStep, isJudgedOnly, isResumable } from "@flowdriven/contracts";
import { type ReactElement, useRef, useState } from "react";
import { AppLink } from "../../nav/AppLink";
import { NotFoundPage } from "../../nav/NotFoundPage";
import { useRunnerAction, useRunnerQuery } from "../../runner/runner-context";
import { Button } from "../../ui/Button";
import { formatDateTime, formatUsd } from "../../ui/format";
import { Icon } from "../../ui/icons";
import { Page } from "../../ui/Page";
import { ScreenState } from "../../ui/ScreenState";
import { Badge, StatusBadge } from "../../ui/StatusBadge";
import styles from "./Runs.module.css";
import { StepBlock } from "./StepBlock";
import { UsageTable } from "./UsageTable";
export function RunDetailScreen({ runId }: { runId: string }): ReactElement {
  const query = useRunnerQuery("runs.status", { runId });
  const approvals = useRunnerQuery("approvals.list", {});
  const action = useRunnerAction();
  const [save, setSave] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [resuming, setResuming] = useState(false);
  const resumeInFlight = useRef(false);
  const [report, setReport] = useState<{
    runId: string;
    open: boolean;
    loading: boolean;
    markdown?: string;
    error?: string;
  }>();
  const reportRequest = useRef({ runId, sequence: 0, loading: false });
  if (reportRequest.current.runId !== runId)
    reportRequest.current = { runId, sequence: reportRequest.current.sequence + 1, loading: false };
  const currentReport =
    report?.runId === runId && (!report.loading || reportRequest.current.loading) ? report : undefined;
  function toggleReport(): void {
    if (reportRequest.current.loading) return;
    if (currentReport?.open) {
      setReport({ runId, open: false, loading: false });
      return;
    }
    reportRequest.current.loading = true;
    const sequence = ++reportRequest.current.sequence;
    setReport({ runId, open: false, loading: true });
    void action("runs.export", { runId }).then((result) => {
      if (reportRequest.current.sequence !== sequence || reportRequest.current.runId !== runId) return;
      reportRequest.current.loading = false;
      setReport(
        result.ok
          ? { runId, open: true, loading: false, markdown: result.data.markdown }
          : { runId, open: false, loading: false, error: result.error.message },
      );
    });
  }
  const loading = query.loading || approvals.loading;
  const error = query.error ?? approvals.error;
  if (!loading && query.error?.code === "not_found")
    return (
      <NotFoundPage
        screen="run"
        title="Run not found"
        text={`There is no run ${runId} on this Mac.`}
        linkLabel="All runs"
        to={{ screen: "runs" }}
      />
    );
  if (loading || error || !query.data)
    return (
      <ScreenState
        screen="run"
        title="Run"
        loading={loading}
        error={error}
        reload={() => {
          query.reload();
          approvals.reload();
        }}
      />
    );
  const run = query.data;
  const next = firstUnpassedStep(run);
  const related = (approvals.data ?? []).filter((item) => run.approvalIds.includes(item.id));
  const actions = (
    <div className={styles.actions}>
      {isResumable(run.state) && next && (
        <Button
          variant="primary"
          size="small"
          disabled={resuming}
          onClick={() => {
            if (resumeInFlight.current) return;
            resumeInFlight.current = true;
            setResuming(true);
            void action("runs.resume", { runId }).then((result) => {
              setActionError(result.ok ? undefined : result.error.message);
              resumeInFlight.current = false;
              setResuming(false);
            });
          }}
        >
          Resume from step {next.index}
        </Button>
      )}
      {run.oneTime && (
        <Button size="small" onClick={() => setSave((value) => !value)}>
          Save as flow
        </Button>
      )}
    </div>
  );
  return (
    <>
      <Page
        screen="run"
        ready
        size="medium"
        title={run.flowName}
        actions={actions}
        before={
          <AppLink className={styles.back} to={{ screen: "runs" }}>
            <Icon name="arrow-left" /> All runs
          </AppLink>
        }
      >
        <div className={styles.meta}>
          <span className={styles.mono}>{run.id}</span>
          <span>Version {run.flowVersion}</span>
          <span>Started {formatDateTime(run.startedAt)}</span>
          {run.endedAt && <span>Ended {formatDateTime(run.endedAt)}</span>}
          {run.oneTime && <Badge tone="neutral">One-time</Badge>}
          <StatusBadge domain="run" value={run.state} />
          {run.trigger && <span>Started by: {run.trigger.words}</span>}
        </div>
        {save && (
          <p className={styles.muted}>
            Saving one-time flows arrives with the agent. Until then this run stays in history.
          </p>
        )}
        {actionError && <p role="alert">{actionError}</p>}
        {isResumable(run.state) && next?.step.state === "interrupted" && (
          <p className={styles.muted}>This step was stopped part-way. Resuming runs it again.</p>
        )}
        {run.blockedReason && (
          <div className={styles.reason}>
            <Icon name="stop" />
            <span>{run.blockedReason}</span>
          </div>
        )}
        <section className={styles.section}>
          <h2>Report</h2>
          {run.report ? (
            <>
              <p>{run.report.lines[0]}</p>
              <p>{run.report.lines[1]}</p>
              <p>{run.report.lines[2]}</p>
              {run.report.saveOffer && <p>Save this as a flow?</p>}
            </>
          ) : (
            <p className={styles.muted}>The report appears when the run ends.</p>
          )}
          <Button size="small" disabled={currentReport?.loading} onClick={toggleReport}>
            {currentReport?.open ? "Hide full report" : "Show full report"}
          </Button>
          {currentReport?.error && <p role="alert">{currentReport.error}</p>}
          {currentReport?.open && (
            <pre role="region" aria-label="Full report" className={styles.fullReport}>
              {currentReport.markdown}
            </pre>
          )}
          {run.steps.some((step) => isJudgedOnly(step.checks)) && (
            <p className={styles.muted}>Some steps were judged, not verified.</p>
          )}
        </section>
        <section className={styles.section}>
          <h2>Steps</h2>
          {run.steps.map((step, index) => (
            <StepBlock key={step.stepId} step={step} index={index + 1} />
          ))}
        </section>
        <section className={styles.section}>
          <h2>Inputs</h2>
          {run.inputs.length === 0 && <p className={styles.muted}>No inputs.</p>}
          <dl className={styles.definitions}>
            {run.inputs.map((input) => (
              <div key={input.id}>
                <dt>{input.label}</dt>
                <dd className={/^(~\/|\/|https?:\/\/)/.test(input.value) ? styles.mono : undefined}>
                  {input.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={styles.section}>
          <h2>Outputs</h2>
          {run.outputs.length ? (
            <ul className={styles.rows}>
              {run.outputs.map((output) => (
                <li key={output.id}>
                  <span className={styles.mono}>{output.id}</span>
                  <span>{output.type}</span>
                  <span className={styles.mono}>{output.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No outputs yet.</p>
          )}
        </section>
        <section className={styles.section}>
          <h2>Approvals</h2>
          {related.length ? (
            <ul className={styles.rows}>
              {related.map((item) => (
                <li key={item.id}>
                  <span>{item.summary}</span>
                  <StatusBadge domain="approval" value={item.state} />
                  <AppLink to={{ screen: "inbox", approvalId: item.id }}>Open in Inbox</AppLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No approvals in this run.</p>
          )}
        </section>
        <section className={styles.section}>
          <h2>Usage</h2>
          {run.usage.length ? (
            <>
              <UsageTable usage={run.usage} />
              <p>Estimated cost: {formatUsd(run.estimatedCostUsd)}. This is an estimate.</p>
            </>
          ) : (
            <>
              <p className={styles.muted}>No usage reported yet.</p>
              <p>Estimated cost: Not reported.</p>
            </>
          )}
        </section>
      </Page>
    </>
  );
}
