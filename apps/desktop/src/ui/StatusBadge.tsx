import type { ReactElement, ReactNode } from "react";
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
export function StatusBadge({ domain, value }: { domain: StatusDomain; value: string }): ReactElement {
  const { tone, icon, label } = statusOf(domain, value);
  const muted = tone === "neutral" && ["pending", "skipped", "queued", "none"].includes(value);
  return (
    <span className={styles.state}>
      <ToneIcon icon={icon} tone={tone} />
      <span className={muted ? styles.muted : undefined}>{label}</span>
    </span>
  );
}
