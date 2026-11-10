import type { ButtonHTMLAttributes, ReactElement } from "react";
import styles from "./Button.module.css";
import { Icon, type IconName } from "./icons";
export function Button({
  variant = "secondary",
  icon,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  icon?: IconName;
}): ReactElement {
  return (
    <button
      type="button"
      {...props}
      className={[
        styles.button,
        styles[variant],
        variant === "quiet" && icon && !children ? styles.iconOnly : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
