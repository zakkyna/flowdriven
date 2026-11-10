import type { Approval, ApprovalDecision } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { AppLink } from "../../nav/AppLink";
import { Button } from "../../ui/Button";
import { formatDateTime } from "../../ui/format";
import { StatusBadge } from "../../ui/StatusBadge";
import { actionName, noun } from "./ApprovalList";
import styles from "./Inbox.module.css";
import { PayloadView, Revealed } from "./PayloadView";

export function ApprovalDetail({
  approval: a,
  similar,
  busy,
  editing,
  text,
  setText,
  edit,
  cancel,
  resolve,
  reject,
  approveAll,
  status,
  error,
  next,
}: {
  approval: Approval;
  similar: Approval[];
  busy: boolean;
  editing: boolean;
  text: string;
  setText: (value: string) => void;
  edit: () => void;
  cancel: () => void;
  resolve: (decision: ApprovalDecision) => void;
  reject: () => void;
  approveAll: () => void;
  status: string;
  error?: string;
  next: () => void;
}): ReactElement {
  return (
    <div className={styles.detail}>
      <div className={styles.decisionBar} role="group" aria-label="Decision state">
        <StatusBadge domain="approval" value={a.state} />
        {a.state === "pending" ? (
          <span>Expires {formatDateTime(a.expiresAt)}</span>
        ) : (
          a.resolvedAt && <span>Resolved {formatDateTime(a.resolvedAt)}</span>
        )}
      </div>
      <div className={styles.detailScroll} data-scroll="top">
        <div className={styles.col}>
          <h2>
            <Revealed text={a.summary} />
          </h2>
          <dl className={styles.definitions}>
            <dt>Action</dt>
            <dd>{actionName(a)}</dd>
            <dt>Flow</dt>
            <dd>
              <Revealed text={a.flowName} />
            </dd>
            {a.stepTitle && (
              <>
                <dt>Step</dt>
                <dd>
                  <Revealed text={a.stepTitle} />
                </dd>
              </>
            )}
            {a.runId && (
              <>
                <dt>Run</dt>
                <dd className={styles.mono}>
                  <AppLink to={{ screen: "run", runId: a.runId }}>
                    <Revealed text={a.runId} />
                  </AppLink>
                </dd>
              </>
            )}
          </dl>
          <PayloadView payload={a.payload} editing={editing} text={text} setText={setText} />
          {a.state === "pending" && (
            <p className={styles.note}>
              {
                {
                  email: "Nothing is sent until you choose.",
                  post: "Nothing is posted until you choose.",
                  amount: "Nothing is paid until you choose.",
                  diff: "Nothing changes until you choose.",
                  text: "Nothing happens until you choose.",
                }[a.payload.kind]
              }
            </p>
          )}
          {a.state === "pending" && (
            <div className={styles.actions}>
              {editing ? (
                <>
                  <Button variant="primary" size="large" disabled={busy} onClick={() => resolve("edit")}>
                    Approve with edits
                  </Button>
                  <Button variant="secondary" size="large" disabled={busy} onClick={cancel}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="primary" size="large" disabled={busy} onClick={() => resolve("approve")}>
                    Approve
                  </Button>
                  {a.editable && (
                    <Button variant="secondary" size="large" disabled={busy} onClick={edit}>
                      Edit
                    </Button>
                  )}
                  <Button variant="secondary" size="large" disabled={busy} onClick={reject}>
                    Reject
                  </Button>
                </>
              )}
            </div>
          )}
          {a.state === "pending" && !editing && similar.length > 1 && (
            <div className={styles.similar}>
              <Button variant="text" disabled={busy} onClick={approveAll}>
                Approve all {similar.length} similar for this run
              </Button>
              <p>
                You see all {similar.length} {noun(a)}s before anything is approved. This covers this run
                only.
              </p>
            </div>
          )}
          {a.state !== "pending" && status && <Button onClick={next}>Next decision</Button>}
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
        </div>
      </div>
    </div>
  );
}
