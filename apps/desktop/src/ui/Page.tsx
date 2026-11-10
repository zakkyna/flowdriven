import type { ReactElement, ReactNode } from "react";
import styles from "./Page.module.css";
export function Page({
  screen,
  ready,
  title,
  description,
  actions,
  children,
}: {
  screen: string;
  ready: boolean;
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}): ReactElement {
  return (
    <section data-screen={screen} data-screen-ready={String(ready)}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
