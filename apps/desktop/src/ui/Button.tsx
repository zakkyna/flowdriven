import type { ButtonHTMLAttributes, ReactElement } from "react";
import styles from "./Button.module.css";
import { Icon, type IconName } from "./icons";
export function Button({
  variant = "secondary",
  size = "default",
  icon,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "text" | "danger";
  size?: "small" | "default" | "large";
  icon?: IconName;
}): ReactElement {
  return (
    <button
      type="button"
      {...props}
      data-variant={variant}
      data-size={size}
      data-icon-only={variant === "quiet" && icon && !children ? "true" : undefined}
      className={[styles.button, className].filter(Boolean).join(" ")}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
