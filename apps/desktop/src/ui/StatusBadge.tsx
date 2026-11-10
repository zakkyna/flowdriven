import type { ReactElement, ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import styles from "./StatusBadge.module.css";
import { type StatusDomain, statusOf, type Tone } from "./status";

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
    <span className={`${styles.badge} ${styles[tone]}`}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </span>
  );
}
export function StatusBadge({ domain, value }: { domain: StatusDomain; value: string }): ReactElement {
  const { tone, icon, label } = statusOf(domain, value);
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}
