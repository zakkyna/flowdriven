import type { ChatMessage, FlowEdit, Step } from "@flowdriven/contracts";
import { type ReactElement, useLayoutEffect, useRef, useState } from "react";
import { NotFoundPage } from "../../nav/NotFoundPage";
import { useRoute } from "../../nav/route";
import { useRunnerAction, useRunnerQuery } from "../../runner/runner-context";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Icon } from "../../ui/icons";
import { ScreenState } from "../../ui/ScreenState";
import { StatusBadge } from "../../ui/StatusBadge";
import styles from "./Builder.module.css";
import { ChatPanel } from "./ChatPanel";
import { Playback } from "./Playback";
import { StepList } from "./StepList";

export function BuilderScreen({ flowId, isNew }: { flowId?: string; isNew?: boolean }): ReactElement {
  const [, navigate] = useRoute();
  const action = useRunnerAction();
  const [errorState, setError] = useState<{ id?: string; message: string }>();
  const [deleted, setDeleted] = useState<Step>();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);
  const [emptyMessages, setEmptyMessages] = useState<ChatMessage[]>([]);
  const list = useRunnerQuery("flows.list", {});
  const id = isNew ? undefined : (flowId ?? list.data?.[0]?.id);
  const previousId = useRef(id);
  if (previousId.current !== id) {
    previousId.current = id;
    if (errorState) setError(undefined);
  }
  const harnesses = useRunnerQuery("harnesses.list", {});
  const error = errorState && errorState.id === id ? errorState.message : undefined;
  const flow = useRunnerQuery("flows.get", { flowId: id ?? "" }, { skip: !id });
  const runId = list.data?.find((item) => item.id === id)?.lastRun?.runId;
  const run = useRunnerQuery("runs.status", { runId: runId ?? "" }, { skip: !runId });
  const loading = list.loading || flow.loading || run.loading || harnesses.loading;
  const queryError = list.error ?? flow.error ?? run.error ?? harnesses.error;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus must follow the selected flow.
  useLayoutEffect(() => {
    if (!loading && !queryError && headingRef.current) {
      document.title = `${headingRef.current.textContent} - FlowDriven`;
      headingRef.current.focus({ preventScroll: true });
    }
  }, [id, loading, queryError]);
  if (flow.error?.code === "not_found" && id)
    return (
      <NotFoundPage
        screen="builder"
        title="Flow not found"
        text={`There is no flow ${id} on this Mac.`}
        linkLabel="Go to Builder"
        to={{ screen: "builder" }}
      />
    );
  if (loading || queryError)
    return (
      <ScreenState
        screen="builder"
        title="Builder"
        loading={loading}
        error={queryError}
        reload={() => {
          list.reload();
          flow.reload();
          run.reload();
          harnesses.reload();
        }}
      />
    );
  const detail = flow.data;
  const edit = async (change: FlowEdit) => {
    if (!id || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const result = await action("flows.update", { flowId: id, edit: change });
    inFlight.current = false;
    setBusy(false);
    if (previousId.current === id) setError(result.ok ? undefined : { id, message: result.error.message });
  };
  const send = async (message: string) => {
    const result = await action("flows.build", { flowId: id, message });
    if (previousId.current === id) setError(result.ok ? undefined : { id, message: result.error.message });
    if (result.ok && !id) {
      setEmptyMessages((messages) => [
        ...messages,
        { id: `user-${messages.length}`, role: "user", text: message, at: result.data.reply.at },
        { ...result.data.reply, id: `reply-${messages.length}` },
      ]);
    }
    return result.ok;
  };
  const runNow = async () => {
    if (!id || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRunning(true);
    const result = await action("flows.run", { flowId: id });
    setRunning(false);
    inFlight.current = false;
    setBusy(false);
    if (previousId.current === id) setError(result.ok ? undefined : { id, message: result.error.message });
    if (result.ok) navigate({ screen: "run", runId: result.data.id });
  };
  return (
    <section data-screen="builder" data-screen-ready="true" className={styles.layout}>
      <div className={styles.main}>
        {detail ? (
          <>
            <div className={styles.toolbar}>
              <label>
                Flow{" "}
                <select
                  value={id}
                  onChange={(event) => navigate({ screen: "builder", flowId: event.target.value })}
                >
                  {list.data?.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <Button
                  variant="quiet"
                  icon="undo"
                  disabled={busy || !detail.canUndo}
                  onClick={() => void edit({ kind: "undo" })}
                >
                  Undo
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => void runNow()}>
                  {running ? "Running..." : "Run now"}
                </Button>
              </div>
            </div>
            <header className={styles.flowHeader}>
              <h1 ref={headingRef} tabIndex={-1}>
                {detail.manifest.name}
              </h1>
              {detail.manifest.summary !== detail.manifest.name && (
                <p className={styles.muted}>{detail.manifest.summary}</p>
              )}
              <div className={styles.meta}>
                <span>{detail.manifest.kind === "build" ? "Build flow" : "Light flow"}</span>
                <span>Version {detail.manifest.version}</span>
                <StatusBadge domain="signOff" value={detail.signOff.state} />
              </div>
              {detail.signOff.state === "approved" && (
                <p className={styles.muted}>Approved for version {detail.signOff.version}</p>
              )}
              {detail.signOff.state === "stale" && (
                <p className={styles.muted}>
                  Approved version {detail.signOff.version}. This version needs your approval before it runs.
                </p>
              )}
            </header>
            <Playback playback={detail.playback} />
            <div className={styles.sectionHeading}>
              <h2>Steps</h2>
              <span className={styles.muted}>
                {detail.manifest.steps.length} {detail.manifest.steps.length === 1 ? "step" : "steps"}
              </span>
              <Button
                icon="plus"
                disabled={busy}
                onClick={() => {
                  setTitle("");
                  setAdding(true);
                }}
              >
                Add step
              </Button>
            </div>
            {error && (
              <p role="alert" className={styles.error}>
                <Icon name="alert" />
                {error}
              </p>
            )}
            <StepList
              flow={detail}
              busy={busy}
              harnesses={harnesses.data ?? []}
              run={run.data}
              edit={(change) => void edit(change)}
              onDelete={setDeleted}
            />
          </>
        ) : (
          <>
            <h1 ref={headingRef} tabIndex={-1}>
              {isNew ? "New flow" : "Builder"}
            </h1>
            <div className={styles.panel}>
              <h2>{isNew ? "Nothing drafted yet." : "No flows yet."}</h2>
              <p>Describe work you repeat, and the agent turns it into a flow.</p>
              {error && (
                <p role="alert" className={styles.error}>
                  <Icon name="alert" />
                  {error}
                </p>
              )}
            </div>
          </>
        )}
      </div>
      <ChatPanel messages={detail?.conversation ?? emptyMessages} send={send} />
      {deleted && (
        <Dialog
          title={`Delete “${deleted.title}”?`}
          confirmLabel="Delete step"
          confirmVariant="danger"
          onCancel={() => setDeleted(undefined)}
          onConfirm={() => {
            void edit({ kind: "delete", stepId: deleted.id });
            setDeleted(undefined);
          }}
        >
          <p>The step id {deleted.id} is retired and never reused.</p>
        </Dialog>
      )}
      {adding && (
        <Dialog
          title="Add a step"
          confirmLabel="Add step"
          confirmDisabled={!title.trim()}
          onCancel={() => setAdding(false)}
          onConfirm={() => {
            void edit({ kind: "add", title: title.trim() });
            setAdding(false);
          }}
        >
          <label>
            Step title <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
        </Dialog>
      )}
    </section>
  );
}
