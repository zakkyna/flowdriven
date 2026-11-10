import type { Approval, ApprovalDecision } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { AppLink } from "../../nav/AppLink";
import { Button } from "../../ui/Button";
import { formatDateTime } from "../../ui/format";
import { StatusBadge } from "../../ui/StatusBadge";
import { actionName } from "./ApprovalList";
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
    <div className={styles.panel}>
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
        <dt>Expires</dt>
        <dd>{formatDateTime(a.expiresAt)}</dd>
        {a.state !== "pending" && (
          <>
            <dt>Decision</dt>
            <dd>
              <StatusBadge domain="approval" value={a.state} />
            </dd>
            {a.resolvedAt && (
              <>
                <dt>Resolved</dt>
                <dd>{formatDateTime(a.resolvedAt)}</dd>
              </>
            )}
          </>
        )}
      </dl>
      <PayloadView payload={a.payload} editing={editing} text={text} setText={setText} />
      {a.state === "pending" && (
        <div className={styles.actions}>
          {editing ? (
            <>
              <Button variant="primary" disabled={busy} onClick={() => resolve("edit")}>
                Approve with edits
              </Button>
              <Button disabled={busy} onClick={cancel}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" disabled={busy} onClick={() => resolve("approve")}>
                Approve
              </Button>
              {a.editable && (
                <Button disabled={busy} onClick={edit}>
                  Edit
                </Button>
              )}
              <Button disabled={busy} onClick={reject}>
                Reject
              </Button>
              {similar.length > 1 && (
                <Button variant="quiet" disabled={busy} onClick={approveAll}>
                  Approve all {similar.length} similar for this run
                </Button>
              )}
            </>
          )}
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
  );
}
