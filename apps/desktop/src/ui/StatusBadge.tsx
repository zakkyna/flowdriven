import type { AgentState, ApprovalState, RunState, StepRunState, TouchRule } from "@flowdriven/contracts";
import type { ReactElement, ReactNode } from "react";
import type { TranslationKey } from "../i18n/t";
import { useLanguage } from "../shell/language";
import { Icon, type IconName } from "./icons";
import styles from "./StatusBadge.module.css";
import { type StatusDomain, statusOf, type Tone } from "./status";

export function ToneIcon({ icon, tone, size }: { icon: IconName; tone: Tone; size?: number }): ReactElement {
  return (
    <span className={`${styles.icon} ${styles[tone]}`}>
      <Icon name={icon} size={size} spin={icon === "ring"} />
    </span>
  );
}
export function StateIcon({
  domain,
  value,
  size,
}: {
  domain: StatusDomain;
  value: string;
  size?: number;
}): ReactElement {
  const { icon, tone } = statusOf(domain, value);
  return <ToneIcon icon={icon} tone={tone} size={size} />;
}
export function Badge({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon?: IconName;
  children: ReactNode;
}): ReactElement {
  return (
    <span className={styles.badge} data-tone={tone}>
      {icon && <ToneIcon icon={icon} tone={tone} size={14} />}
      {children}
    </span>
  );
}

type StatusEntry = {
  icon: IconName;
  tone: Tone;
  key: TranslationKey;
  muted?: boolean;
};

const runStatuses: Record<RunState, StatusEntry> = {
  queued: { icon: "clock", tone: "neutral", key: "status.queued", muted: true },
  checking: { icon: "ring", tone: "info", key: "status.checking" },
  running: { icon: "ring", tone: "info", key: "status.running" },
  waiting_approval: { icon: "hand", tone: "wait", key: "status.waiting_approval" },
  needs_login: { icon: "key", tone: "wait", key: "status.needs_login" },
  retrying: { icon: "retry", tone: "info", key: "status.retrying" },
  blocked: { icon: "alert", tone: "bad", key: "status.blocked" },
  interrupted: { icon: "pause", tone: "neutral", key: "status.interrupted" },
  stopped: { icon: "stop", tone: "neutral", key: "status.stopped" },
  done: { icon: "check", tone: "ok", key: "status.done" },
  failed: { icon: "cross", tone: "bad", key: "status.failed" },
};

const stepStatuses: Record<StepRunState, StatusEntry> = {
  pending: { icon: "dash", tone: "neutral", key: "status.not_started", muted: true },
  running: { icon: "ring", tone: "info", key: "status.running" },
  retrying: { icon: "retry", tone: "info", key: "status.retrying" },
  waiting_approval: { icon: "hand", tone: "wait", key: "status.waiting_approval" },
  passed: { icon: "check", tone: "ok", key: "status.passed" },
  failed: { icon: "cross", tone: "bad", key: "status.failed" },
  skipped: { icon: "dash", tone: "neutral", key: "status.skipped", muted: true },
  interrupted: { icon: "pause", tone: "neutral", key: "status.interrupted" },
  stopped: { icon: "stop", tone: "neutral", key: "status.stopped" },
};

const decisionStatuses: Record<ApprovalState, StatusEntry> = {
  pending: { icon: "hand", tone: "wait", key: "status.waiting" },
  approved: { icon: "check", tone: "ok", key: "status.approved" },
  approved_edited: { icon: "check", tone: "ok", key: "status.approved_edited" },
  rejected: { icon: "cross", tone: "bad", key: "status.rejected" },
  expired: { icon: "clock", tone: "neutral", key: "status.expired" },
  allowed_always: { icon: "shield", tone: "ok", key: "status.allowed_always" },
  another_way: { icon: "undo", tone: "info", key: "status.another_way" },
};

const agentStatuses: Record<AgentState, StatusEntry> = {
  not_installed: { icon: "circle-slash", tone: "neutral", key: "status.not_installed", muted: true },
  installing: { icon: "ring", tone: "info", key: "status.installing" },
  waiting_login: { icon: "clock", tone: "wait", key: "status.needs_login" },
  needs_login: { icon: "key", tone: "wait", key: "agents.needsSignIn" },
  ready: { icon: "check", tone: "ok", key: "status.ready" },
  unknown: { icon: "dash", tone: "neutral", key: "status.unchecked", muted: true },
};

export type StatusBadgeProps =
  | { domain: StatusDomain; value: string }
  | { kind: "run"; code: RunState }
  | { kind: "step"; code: StepRunState }
  | { kind: "decision"; code: ApprovalState }
  | { kind: "agent"; code: AgentState };

function getV2Status(props: Exclude<StatusBadgeProps, { domain: StatusDomain; value: string }>): StatusEntry {
  switch (props.kind) {
    case "run":
      return runStatuses[props.code];
    case "step":
      return stepStatuses[props.code];
    case "decision":
      return decisionStatuses[props.code];
    case "agent":
      return agentStatuses[props.code];
  }
}

export function StatusBadge(props: StatusBadgeProps): ReactElement {
  const { t } = useLanguage();
  if ("domain" in props) {
    const { tone, icon, label } = statusOf(props.domain, props.value);
    const muted = tone === "neutral" && ["pending", "skipped", "queued", "none"].includes(props.value);
    return (
      <span className={styles.state}>
        <ToneIcon icon={icon} tone={tone} />
        <span className={muted ? styles.muted : undefined}>{label}</span>
      </span>
    );
  }
  const entry = getV2Status(props);
  return (
    <span className={styles.state}>
      <ToneIcon icon={entry.icon} tone={entry.tone} />
      <span className={entry.muted ? styles.muted : undefined}>{t(entry.key)}</span>
    </span>
  );
}

export function TouchBadge({ rule }: { rule: TouchRule }): ReactElement {
  const { t } = useLanguage();
  let icon: IconName;
  let tone: Tone;
  let label: string;
  switch (rule) {
    case "runs_alone":
      icon = "check";
      tone = "ok";
      label = t("common.doesOnItsOwn");
      break;
    case "asks_first":
      icon = "hand";
      tone = "wait";
      label = t("common.asksYouFirst");
      break;
    case "not_allowed":
      icon = "stop";
      tone = "bad";
      label = t("common.neverDoes");
      break;
  }
  return (
    <span className={styles.state}>
      <ToneIcon icon={icon} tone={tone} />
      <span>{label}</span>
    </span>
  );
}
