import type { ApprovalDecision } from "@flowdriven/contracts";
import { type ReactElement, useLayoutEffect, useRef, useState } from "react";
import { NotFoundPage } from "../../nav/NotFoundPage";
import { useRoute } from "../../nav/route";
import { useRunnerAction, useRunnerQuery } from "../../runner/runner-context";
import { Dialog } from "../../ui/Dialog";
import { ScreenState } from "../../ui/ScreenState";
import { ApprovalDetail } from "./ApprovalDetail";
import { ApprovalList, noun } from "./ApprovalList";
import styles from "./Inbox.module.css";
import { Revealed } from "./PayloadView";

const description = "Decisions waiting for you. Nothing risky happens until you approve it.";
export function InboxScreen({ approvalId }: { approvalId?: string }): ReactElement {
  const [, navigate] = useRoute();
  const query = useRunnerQuery("approvals.list", {});
  const action = useRunnerAction();
  const [tab, setTab] = useState<"waiting" | "resolved">("waiting");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [dialog, setDialog] = useState<{ kind: "reject" | "all"; approvalId: string; ids: string[] }>();
  const pinned = useRef<string | undefined>(undefined);
  const previousSelection = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const justResolved = useRef(new Set<string>());
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const loaded = !query.loading && !query.error;
  useLayoutEffect(() => {
    if (!loaded || !headingRef.current) return;
    document.title = "Inbox - FlowDriven";
    headingRef.current.focus({ preventScroll: true });
  }, [loaded]);
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
  const identified = all.find((a) => a.id === (approvalId ?? pinned.current));
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
  for (const item of all) {
    if (item.state !== "pending") justResolved.current.delete(item.id);
  }
  const waiting = all.filter((a) => a.state === "pending");
  const resolved = all.filter((a) => a.state !== "pending");
  const activeTab = identified ? (identified.state === "pending" ? "waiting" : "resolved") : tab;
  const items = activeTab === "waiting" ? waiting : resolved;
  if (!approvalId && !pinned.current && items[0]) pinned.current = items[0].id;
  const selected = identified ?? items.find((item) => item.id === pinned.current) ?? items[0];
  if (previousSelection.current && previousSelection.current !== selected?.id) {
    setEditing(false);
    setDialog(undefined);
    setStatus("");
    setError(undefined);
  }
  previousSelection.current = selected?.id;
  const similar = selected?.similarGroup
    ? waiting.filter((a) => a.similarGroup === selected.similarGroup && a.runId === selected.runId)
    : [];
  const plural = selected ? `${noun(selected)}s` : "";
  const clearSelection = () => {
    pinned.current = undefined;
    setEditing(false);
    setDialog(undefined);
    setStatus("");
    setError(undefined);
  };
  const resolve = async (decision: ApprovalDecision, ids = selected ? [selected.id] : []) => {
    if (!selected || !ids.length || inFlight.current || ids.some((id) => justResolved.current.has(id)))
      return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setStatus("");
    let count = 0;
    let failure: string | undefined;
    for (const id of ids) {
      const result = await action("approvals.resolve", {
        approvalId: id,
        decision,
        ...(decision === "edit" ? { editedText: text } : {}),
      });
      if (!result.ok) {
        failure = result.error.message;
        break;
      }
      justResolved.current.add(id);
      count += result.data.length;
    }
    if (failure) {
      if (count) {
        setDialog(undefined);
        if (previousSelection.current === selected.id) navigate({ screen: "inbox", approvalId: selected.id });
      }
      if (previousSelection.current === selected.id)
        setError(count ? `${count} approved before the error: ${failure}` : failure);
    } else if (previousSelection.current === selected.id) {
      setStatus(
        decision === "reject"
          ? "Rejected."
          : decision === "edit"
            ? "Approved with edits."
            : ids.length > 1
              ? `Approved ${count} ${plural}.`
              : "Approved.",
      );
      setEditing(false);
      setDialog(undefined);
      pinned.current = selected.id;
      navigate({ screen: "inbox", approvalId: selected.id });
    }
    inFlight.current = false;
    setBusy(false);
  };
  const answer = async (picks: string[]) => {
    if (!selected || inFlight.current || justResolved.current.has(selected.id)) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setStatus("");
    const result = await action("approvals.answer", { approvalId: selected.id, picks });
    if (result.ok) {
      justResolved.current.add(selected.id);
      if (previousSelection.current === selected.id) {
        setStatus("Choice sent.");
        pinned.current = selected.id;
        navigate({ screen: "inbox", approvalId: selected.id });
      }
    } else if (previousSelection.current === selected.id) setError(result.error.message);
    inFlight.current = false;
    setBusy(false);
  };
  return (
    <section data-screen="inbox" data-screen-ready="true" className={styles.layout}>
      <div className={styles.listZone}>
        <header className={styles.bar}>
          <h1 ref={headingRef} tabIndex={-1}>
            Inbox
          </h1>
        </header>
        <div role="tablist" aria-label="Decisions" className={styles.tabs}>
          {(["waiting", "resolved"] as const).map((value) => (
            <button
              type="button"
              role="tab"
              className={styles.tab}
              id={`inbox-tab-${value}`}
              aria-controls="inbox-panel"
              aria-selected={activeTab === value}
              tabIndex={activeTab === value ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const next = value === "waiting" ? "resolved" : "waiting";
                  clearSelection();
                  setTab(next);
                  navigate({ screen: "inbox" });
                  document.getElementById(`inbox-tab-${next}`)?.focus();
                }
              }}
              key={value}
              onClick={() => {
                setTab(value);
                clearSelection();
                navigate({ screen: "inbox" });
              }}
            >
              {value === "waiting" ? "Waiting" : "Resolved"}{" "}
              <span className={styles.count}>({value === "waiting" ? waiting.length : resolved.length})</span>
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="inbox-panel"
          aria-labelledby={`inbox-tab-${activeTab}`}
          className={styles.items}
        >
          {items.length ? (
            <ApprovalList
              items={items}
              selected={selected?.id}
              select={(id) => {
                clearSelection();
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
      </div>
      {selected && (
        <ApprovalDetail
          key={selected.id}
          approval={selected}
          status={status}
          error={dialog ? undefined : error}
          next={() => {
            clearSelection();
            setTab("waiting");
            navigate({ screen: "inbox" });
          }}
          similar={similar}
          busy={busy || justResolved.current.has(selected.id)}
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
          answer={(picks) => void answer(picks)}
          reject={() => setDialog({ kind: "reject", approvalId: selected.id, ids: [selected.id] })}
          approveAll={() =>
            setDialog({ kind: "all", approvalId: selected.id, ids: similar.map((a) => a.id) })
          }
        />
      )}
      {dialog?.kind === "reject" && selected?.id === dialog.approvalId && (
        <Dialog
          title={`Reject this ${noun(selected)}?`}
          confirmLabel="Reject"
          confirmVariant="danger"
          cancelLabel="Keep waiting"
          confirmDisabled={busy}
          onCancel={() => setDialog(undefined)}
          onConfirm={() => void resolve("reject", dialog.ids)}
        >
          <p>
            {selected.runId ? (
              <>
                The run stops at step “<Revealed text={selected.stepTitle ?? ""} />” and is marked failed.
              </>
            ) : (
              "Nothing runs until you approve a version of this flow."
            )}
          </p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </Dialog>
      )}
      {dialog?.kind === "all" && selected?.id === dialog.approvalId && (
        <Dialog
          title={`Approve ${dialog.ids.length} similar ${plural}?`}
          confirmLabel={`Approve ${dialog.ids.length}`}
          confirmDisabled={busy}
          cancelDisabled={busy}
          onCancel={() => setDialog(undefined)}
          onConfirm={() => void resolve("approve", dialog.ids)}
        >
          <p>
            These items from run <Revealed text={selected.runId ?? ""} /> are approved individually:
          </p>
          <ul>
            {dialog.ids
              .map((id) => all.find((a) => a.id === id))
              .filter((a) => a !== undefined)
              .map((a) => (
                <li key={a.id}>
                  <Revealed text={a.summary} />
                </li>
              ))}
          </ul>
          <p>This covers this run only and is logged.</p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </Dialog>
      )}
    </section>
  );
}
