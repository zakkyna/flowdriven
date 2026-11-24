import { type KeyboardEvent, type ReactElement, useId, useState } from "react";
import { APP_NAME } from "../app-info";
import type { TranslationKey } from "../i18n/t";
import { AppLink } from "../nav/AppLink";
import { type Route, useRoute } from "../nav/route";
import { useRunnerAction, useRunnerQuery } from "../runner/runner-context";
import { Icon, type IconName } from "../ui/icons";
import { ChatList } from "./ChatList";
import { useLanguage } from "./language";
import styles from "./Rail.module.css";

export const RAIL_MORE_STORAGE_KEY = "flowdriven:railMoreOpen";

export type SecondaryNavId = "skills" | "memory" | "marketplace" | "phone";

export type SecondaryNavItem = {
  id: SecondaryNavId;
  href: string;
  current?: boolean;
  needsYou?: boolean;
};

export type MorePreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export const V1_SECONDARY_ITEMS: readonly SecondaryNavItem[] = [{ id: "skills", href: "#/skills" }];

const SECONDARY_ORDER: readonly SecondaryNavId[] = ["skills", "memory", "marketplace", "phone"];

function readMorePreference(storage?: MorePreferenceStorage): boolean {
  try {
    const store = storage ?? window.localStorage;
    return store.getItem(RAIL_MORE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeMorePreference(open: boolean, storage?: MorePreferenceStorage): void {
  try {
    const store = storage ?? window.localStorage;
    store.setItem(RAIL_MORE_STORAGE_KEY, open ? "true" : "false");
  } catch {
    /* Storage failure leaves the preference ephemeral and never throws. */
  }
}

function secondaryIcon(id: SecondaryNavId): IconName {
  switch (id) {
    case "skills":
      return "list";
    case "memory":
      return "mark";
    case "marketplace":
      return "post";
    case "phone":
      return "send";
  }
}

function secondaryLabel(id: SecondaryNavId, t: (key: TranslationKey) => string): string {
  switch (id) {
    case "skills":
      return t("rail.skills");
    case "memory":
      return t("common.memory");
    case "marketplace":
      return t("common.marketplace");
    case "phone":
      return t("common.phoneBots");
  }
}

export function Rail({
  route,
  compact = false,
  onOpenSearch,
  now,
  zone,
  secondaryItems = V1_SECONDARY_ITEMS,
  moreStorage,
}: {
  route: Route;
  compact?: boolean;
  onOpenSearch?: () => void;
  now?: () => number;
  zone?: string;
  secondaryItems?: readonly SecondaryNavItem[];
  moreStorage?: MorePreferenceStorage;
}): ReactElement {
  const { t } = useLanguage();
  const [, navigate] = useRoute();
  const action = useRunnerAction();
  const activity = useRunnerQuery("activity.summary", {});
  const needsYouCount = activity.data?.needsYouCount ?? 0;
  const moreListId = useId();
  const [moreOpen, setMoreOpen] = useState(() => readMorePreference(moreStorage));

  const orderedSecondary = [...secondaryItems].sort(
    (a, b) => SECONDARY_ORDER.indexOf(a.id) - SECONDARY_ORDER.indexOf(b.id),
  );
  const useMore = orderedSecondary.length >= 2;
  const isItemCurrent = (item: SecondaryNavItem): boolean =>
    item.current ?? (item.id === "skills" && route.screen === "skills");
  const visibleCurrentWhenClosed = useMore && !moreOpen ? orderedSecondary.filter(isItemCurrent) : [];
  const hiddenNeedsYou =
    useMore && !moreOpen && orderedSecondary.some((item) => !isItemCurrent(item) && item.needsYou);

  const toggleMore = () => {
    setMoreOpen((prev) => {
      const next = !prev;
      writeMorePreference(next, moreStorage);
      return next;
    });
  };

  const handleMoreKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleMore();
    }
  };

  const handleNewChat = () => {
    void action("chats.create", {}).then((result) => {
      if (result.ok) navigate({ screen: "chat", chatId: result.data.chatId });
    });
  };

  const renderSecondaryItem = (item: SecondaryNavItem): ReactElement => {
    const label = secondaryLabel(item.id, t);
    const current = isItemCurrent(item);
    const attention = item.needsYou ? (
      <>
        {" "}
        <span className={styles.attention} title={t("rail.somethingNeedsYou")}>
          <Icon name="alert" size={14} />
          <span className={styles.srOnly}>{t("rail.somethingNeedsYou")}</span>
        </span>
      </>
    ) : null;
    if (item.id === "skills") {
      return (
        <AppLink
          key={item.id}
          to={{ screen: "skills" }}
          className={styles.item}
          aria-current={current ? "page" : undefined}
          data-rail-item="true"
        >
          <span className={styles.navIcon}>
            <Icon name={secondaryIcon(item.id)} />
          </span>
          <span className={styles.itemLabel}>{label}</span>
          {attention}
        </AppLink>
      );
    }
    return (
      <a
        key={item.id}
        href={item.href}
        className={styles.item}
        aria-current={current ? "page" : undefined}
        data-rail-item="true"
      >
        <span className={styles.navIcon}>
          <Icon name={secondaryIcon(item.id)} />
        </span>
        <span className={styles.itemLabel}>{label}</span>
        {attention}
      </a>
    );
  };

  return (
    <div className={styles.rail}>
      <div className={styles.brand}>
        <span className={styles.mark}>
          <Icon name="mark" size={14} />
        </span>
        {!compact && <span>{APP_NAME}</span>}
      </div>
      <nav aria-label={t("rail.mainMenu")} className={styles.nav} data-compact={compact ? "true" : undefined}>
        <div className={styles.menu} data-rail-part="menu">
          <button type="button" className={styles.actionItem} onClick={handleNewChat} data-rail-item="true">
            <span className={styles.navIcon}>
              <Icon name="plus" />
            </span>
            <span className={styles.itemLabel}>{t("rail.newChat")}</span>
          </button>
          <button type="button" className={styles.actionItem} onClick={onOpenSearch} data-rail-item="true">
            <span className={styles.navIcon}>
              <Icon name="ring" />
            </span>
            <span className={styles.itemLabel}>{t("rail.search")}</span>
          </button>
          <AppLink
            to={{ screen: "flows" }}
            className={styles.item}
            aria-current={route.screen === "flows" || route.screen === "flow" ? "page" : undefined}
            data-rail-item="true"
          >
            <span className={styles.navIcon}>
              <Icon name="builder" />
            </span>
            <span className={styles.itemLabel}>{t("rail.flows")}</span>
          </AppLink>
          <AppLink
            to={{ screen: "activity" }}
            className={styles.item}
            aria-current={route.screen === "activity" || route.screen === "activity_run" ? "page" : undefined}
            data-rail-item="true"
          >
            <span className={styles.navIcon}>
              <Icon name="runs" />
            </span>
            <span className={styles.itemLabel}>{t("rail.activity")}</span>
            {needsYouCount > 0 && (
              <>
                {" "}
                <span className={styles.count}>{needsYouCount}</span>
              </>
            )}
          </AppLink>
          {!useMore && orderedSecondary.map(renderSecondaryItem)}
          {useMore && visibleCurrentWhenClosed.map(renderSecondaryItem)}
          {useMore && (
            <>
              <button
                type="button"
                className={styles.actionItem}
                aria-expanded={moreOpen}
                aria-controls={moreListId}
                title={hiddenNeedsYou ? t("rail.somethingNeedsYou") : undefined}
                onClick={toggleMore}
                onKeyDown={handleMoreKeyDown}
              >
                <span className={styles.navIcon}>
                  <Icon name={moreOpen ? "arrow-up" : "arrow-down"} />
                </span>
                <span className={styles.itemLabel}>{moreOpen ? t("rail.showLess") : t("rail.showMore")}</span>
                {hiddenNeedsYou && (
                  <>
                    {" "}
                    <span className={styles.attention} title={t("rail.somethingNeedsYou")}>
                      <Icon name="alert" size={14} />
                      <span className={styles.srOnly}>{t("rail.somethingNeedsYou")}</span>
                    </span>
                  </>
                )}
              </button>
              <div id={moreListId} className={styles.moreList} hidden={!moreOpen}>
                {moreOpen && orderedSecondary.map(renderSecondaryItem)}
              </div>
            </>
          )}
        </div>
        <div className={styles.divider} aria-hidden="true" />
        <div data-scroll="chats" className={styles.chats}>
          <ChatList route={route} now={now} zone={zone} />
        </div>
        <div className={styles.footer} data-rail-part="footer">
          <AppLink
            to={{ screen: "settings" }}
            className={styles.item}
            aria-current={route.screen === "settings" ? "page" : undefined}
            data-rail-item="true"
          >
            <span className={styles.navIcon}>
              <Icon name="settings" />
            </span>
            <span className={styles.itemLabel}>{t("rail.settings")}</span>
          </AppLink>
        </div>
      </nav>
    </div>
  );
}
