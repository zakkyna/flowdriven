import type { ApprovalDecision } from "@flowdriven/contracts";
import { type ReactElement, useRef, useState } from "react";
import { NotFoundPage } from "../../nav/NotFoundPage";
import { useRoute } from "../../nav/route";
import { useRunnerAction, useRunnerQuery } from "../../runner/runner-context";
import { Dialog } from "../../ui/Dialog";
import { Page } from "../../ui/Page";
import { ScreenState } from "../../ui/ScreenState";
import { ApprovalDetail } from "./ApprovalDetail";
import { ApprovalList, noun } from "./ApprovalList";
import styles from "./Inbox.module.css";

const description = "Decisions waiting for you. Nothing risky happens until you approve it.";
export function InboxScreen({ approvalId }: { approvalId?: string }): ReactElement {
  const [, navigate] = useRoute();
  const query = useRunnerQuery("approvals.list", {});
  const action = useRunnerAction();
  const [tab, setTab] = useState<"waiting" | "resolved">("waiting");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [dialog, setDialog] = useState<"reject" | "all">();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string>();
  if (query.loading || query.error)
    return (
      <ScreenState
        screen="inbox"
        title="Inbox"
        description={description}
        loading={query.loading}
        error={query.error}
        reload={query.reload}
      />
    );
  const all = [...(query.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const identified = approvalId ? all.find((a) => a.id === approvalId) : undefined;
  if (approvalId && !identified)
    return (
      <NotFoundPage
        screen="inbox"
        title="Decision not found"
        text={`There is no decision ${approvalId} in your inbox.`}
        linkLabel="Go to Inbox"
        to={{ screen: "inbox" }}
      />
    );
  const waiting = all.filter((a) => a.state === "pending");
  const resolved = all.filter((a) => a.state !== "pending");
  const activeTab = identified ? (identified.state === "pending" ? "waiting" : "resolved") : tab;
  const items = activeTab === "waiting" ? waiting : resolved;
  const selected = identified ?? items[0];
  const similar = selected?.similarGroup
    ? waiting.filter((a) => a.similarGroup === selected.similarGroup && a.runId === selected.runId)
    : [];
  const plural = selected ? `${noun(selected)}s` : "";
  const resolve = async (decision: ApprovalDecision, applyToSimilar = false) => {
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    const result = await action("approvals.resolve", {
      approvalId: selected.id,
      decision,
      ...(decision === "edit" ? { editedText: text } : {}),
      ...(applyToSimilar ? { applyToSimilar: true } : {}),
    });
    if (result.ok) {
      setStatus(
        decision === "reject"
          ? "Rejected."
          : decision === "edit"
            ? "Approved with edits."
            : applyToSimilar
              ? `Approved ${similar.length} ${plural}.`
              : "Approved.",
      );
      setEditing(false);
      setDialog(undefined);
      setTab("waiting");
      navigate({ screen: "inbox" });
    } else setError(result.error.message);
    inFlight.current = false;
    setBusy(false);
  };
  return (
    <Page screen="inbox" ready title="Inbox" description={description}>
      <div className={styles.layout}>
        <div>
          <div role="tablist" aria-label="Decisions" className={styles.tabs}>
            {(["waiting", "resolved"] as const).map((value) => (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === value}
                key={value}
                onClick={() => {
                  setTab(value);
                  setEditing(false);
                  navigate({ screen: "inbox" });
                }}
              >
                {value === "waiting" ? `Waiting (${waiting.length})` : `Resolved (${resolved.length})`}
              </button>
            ))}
          </div>
          {items.length ? (
            <ApprovalList
              items={items}
              selected={selected?.id}
              select={(id) => {
                setEditing(false);
                navigate({ screen: "inbox", approvalId: id });
              }}
            />
          ) : activeTab === "waiting" ? (
            <div>
              <h2>Nothing is waiting for you.</h2>
              <p>When a run needs a decision, it shows up here.</p>
            </div>
          ) : (
            <p>No resolved decisions yet.</p>
          )}
        </div>
        {selected && (
          <ApprovalDetail
            approval={selected}
            similar={similar}
            busy={busy}
            editing={editing}
            text={text}
            setText={setText}
            edit={() => {
              const p = selected.payload;
              setText(p.kind === "email" ? p.body : p.kind === "post" || p.kind === "text" ? p.text : "");
              setEditing(true);
            }}
            cancel={() => setEditing(false)}
            resolve={(decision) => void resolve(decision)}
            reject={() => setDialog("reject")}
            approveAll={() => setDialog("all")}
          />
        )}
      </div>
      {status && (
        <p role="status" className={styles.muted}>
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <p className={styles.small}>
        Approvals expire after 24 hours. The step then fails with a clear reason.
      </p>
      {dialog === "reject" && selected && (
        <Dialog
          title={`Reject this ${noun(selected)}?`}
          confirmLabel="Reject"
          confirmVariant="danger"
          cancelLabel="Keep waiting"
          confirmDisabled={busy}
          onCancel={() => setDialog(undefined)}
          onConfirm={() => void resolve("reject")}
        >
          <p>
            {selected.runId
              ? `The run stops at step “${selected.stepTitle}” and is marked failed.`
              : "Nothing runs until you approve a version of this flow."}
          </p>
        </Dialog>
      )}
      {dialog === "all" && selected && (
        <Dialog
          title={`Approve ${similar.length} similar ${plural}?`}
          confirmLabel={`Approve ${similar.length}`}
          confirmDisabled={busy}
          onCancel={() => setDialog(undefined)}
          onConfirm={() => void resolve("approve", true)}
        >
          <p>These items from run {selected.runId} are approved together:</p>
          <ul>
            {similar.map((a) => (
              <li key={a.id}>{a.summary}</li>
            ))}
          </ul>
          <p>This covers this run only and is logged.</p>
        </Dialog>
      )}
    </Page>
  );
}
