import { type ReactElement, type ReactNode, useLayoutEffect, useRef } from "react";
import styles from "./Page.module.css";
export function Page({
  screen,
  ready,
  title,
  description,
  actions,
  before,
  size = "medium",
  children,
}: {
  screen: string;
  ready: boolean;
  title: string;
  description?: string;
  actions?: ReactNode;
  before?: ReactNode;
  size?: "narrow" | "medium" | "wide";
  children?: ReactNode;
}): ReactElement {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    document.title = `${title} - FlowDriven`;
    headingRef.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <section className={styles.page} data-screen={screen} data-screen-ready={String(ready)}>
      <header className={styles.bar}>
        {before}
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        {actions}
      </header>
      <div className={styles.body} data-scroll="top">
        <div className={styles.column} data-size={size}>
          {description && <p className={styles.description}>{description}</p>}
          {children}
        </div>
      </div>
    </section>
  );
}
