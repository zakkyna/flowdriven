import { type ReactElement, type ReactNode, useLayoutEffect, useRef } from "react";
import styles from "./Page.module.css";
export function Page({
  screen,
  ready,
  title,
  description,
  actions,
  before,
  children,
}: {
  screen: string;
  ready: boolean;
  title: string;
  description?: string;
  actions?: ReactNode;
  before?: ReactNode;
  children?: ReactNode;
}): ReactElement {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    document.title = `${title} - FlowDriven`;
    headingRef.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <section className={styles.page} data-screen={screen} data-screen-ready={String(ready)}>
      {before}
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 ref={headingRef} tabIndex={-1}>
            {title}
          </h1>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
