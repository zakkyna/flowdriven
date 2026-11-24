import { type ReactElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AppLink } from "../nav/AppLink";
import { type Route, routeToHash } from "../nav/route";
import { useRunnerQuery } from "../runner/runner-context";
import { Icon } from "../ui/icons";
import styles from "./Drawer.module.css";
import { useLanguage } from "./language";
import { type MorePreferenceStorage, Rail, type SecondaryNavItem } from "./Rail";

export const NARROW_QUERY = "(max-width: 767px)";
export const COMPACT_QUERY = "(max-width: 399px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [query]);
  return matches;
}

export function Drawer({
  route,
  pageTitle,
  compact,
  onOpenSearch,
  now,
  zone,
  secondaryItems,
  moreStorage,
}: {
  route: Route;
  pageTitle: string;
  compact: boolean;
  onOpenSearch?: () => void;
  now?: () => number;
  zone?: string;
  secondaryItems?: readonly SecondaryNavItem[];
  moreStorage?: MorePreferenceStorage;
}): ReactElement {
  const { t } = useLanguage();
  const drawerId = useId();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);
  const wasOpenRef = useRef(false);
  const routeKey = routeToHash(route);
  const prevRouteRef = useRef(routeKey);
  const activity = useRunnerQuery("activity.summary", {});
  const needsYouCount = activity.data?.needsYouCount ?? 0;

  const closeAndReturnFocus = useCallback(() => {
    returnFocusRef.current = true;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (prevRouteRef.current !== routeKey) {
      prevRouteRef.current = routeKey;
      if (open) {
        returnFocusRef.current = false;
        setOpen(false);
      }
    }
  }, [open, routeKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndReturnFocus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeAndReturnFocus, open]);

  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      closeButtonRef.current?.focus();
    } else if (!open && wasOpenRef.current && returnFocusRef.current) {
      returnFocusRef.current = false;
      menuButtonRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <>
      <header className={styles.topBar}>
        <button
          type="button"
          ref={menuButtonRef}
          className={styles.menuAction}
          aria-expanded={open}
          aria-controls={drawerId}
          onClick={() => setOpen(true)}
        >
          <Icon name="list" />
          <span>{t("rail.menu")}</span>
        </button>
        <span className={styles.title}>{pageTitle}</span>
        <AppLink to={{ screen: "activity" }} className={styles.activityLink}>
          <Icon name="runs" />
          <span>{t("rail.activity")}</span>
          {needsYouCount > 0 && (
            <>
              {" "}
              <span className={styles.count}>{needsYouCount}</span>
            </>
          )}
        </AppLink>
      </header>
      {open && (
        <>
          <div
            className={styles.scrim}
            data-drawer-scrim="true"
            aria-hidden="true"
            onClick={closeAndReturnFocus}
          />
          <div
            id={drawerId}
            role="dialog"
            aria-modal="true"
            aria-label={t("rail.menu")}
            className={styles.drawer}
          >
            <div className={styles.drawerHeader}>
              <button
                type="button"
                ref={closeButtonRef}
                className={styles.closeAction}
                onClick={closeAndReturnFocus}
              >
                <Icon name="cross" />
                <span>{t("rail.closeMenu")}</span>
              </button>
            </div>
            <div className={styles.drawerBody}>
              <Rail
                route={route}
                compact={compact}
                onOpenSearch={onOpenSearch}
                now={now}
                zone={zone}
                secondaryItems={secondaryItems}
                moreStorage={moreStorage}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
