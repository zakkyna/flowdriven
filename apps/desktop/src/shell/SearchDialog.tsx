import type { SearchResult } from "@flowdriven/contracts";
import {
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { type Route, useRoute } from "../nav/route";
import { useRunnerQuery } from "../runner/runner-context";
import { SafeText } from "../text/SafeText";
import { Icon } from "../ui/icons";
import { useLanguage } from "./language";
import styles from "./SearchDialog.module.css";

const focusableSelector =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

type SearchChat = SearchResult["chats"][number];
type SearchFlow = SearchResult["flows"][number];

type SearchItem =
  | { kind: "chat"; id: string; chat: SearchChat; route: Route }
  | { kind: "flow"; id: string; flow: SearchFlow; route: Route };

function SearchDialogPanel({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useLanguage();
  const [, navigate] = useRoute();
  const listboxId = useId();
  const chatsHeadingId = useId();
  const flowsHeadingId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { data, loading } = useRunnerQuery("search.query", { text: query });
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef(true);

  const chats = data?.chats ?? [];
  const flows = data?.flows ?? [];
  const items: SearchItem[] = [
    ...chats.map((chat) => ({
      kind: "chat" as const,
      id: `chat-${chat.chatId}`,
      chat,
      route: { screen: "chat" as const, chatId: chat.chatId },
    })),
    ...flows.map((flow) => ({
      kind: "flow" as const,
      id: `flow-${flow.flowId}`,
      flow,
      route: { screen: "flow" as const, flowId: flow.flowId },
    })),
  ];

  const safeIndex = items.length === 0 ? -1 : Math.min(activeIndex, items.length - 1);
  const activeOption = safeIndex >= 0 ? items[safeIndex] : undefined;
  const activeOptionId = activeOption ? `${listboxId}-${activeOption.id}` : undefined;

  const closeWithFocusReturn = useCallback(() => {
    returnFocusRef.current = true;
    onClose();
  }, [onClose]);

  const selectItem = useCallback(
    (item: SearchItem) => {
      returnFocusRef.current = false;
      navigate(item.route);
      onClose();
    },
    [navigate, onClose],
  );

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (!panel) return;

    const marked: HTMLElement[] = [];
    let node: HTMLElement | null = panel;
    while (node && node !== document.body && node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          marked.push(sibling);
        }
      }
      node = node.parentElement;
    }

    inputRef.current?.focus();

    return () => {
      for (const element of marked) {
        element.removeAttribute("inert");
      }
      if (returnFocusRef.current) {
        previous?.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeWithFocusReturn();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeWithFocusReturn]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (items.length > 0) {
          setActiveIndex((safeIndex + 1) % items.length);
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (items.length > 0) {
          setActiveIndex((safeIndex - 1 + items.length) % items.length);
        }
        break;
      case "Home":
        if (items.length > 0) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (items.length > 0) {
          event.preventDefault();
          setActiveIndex(items.length - 1);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (activeOption) {
          selectItem(activeOption);
        }
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeWithFocusReturn();
        break;
    }
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      closeWithFocusReturn();
      return;
    }
    if (event.key === "Tab") {
      const controls = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.closest("[hidden], [inert]") && element.tabIndex >= 0);
      event.preventDefault();
      if (controls.length === 0) {
        event.currentTarget.focus();
        return;
      }
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const currentIndex = active ? controls.indexOf(active) : -1;
      const len = controls.length;
      const nextIndex =
        currentIndex === -1
          ? event.shiftKey
            ? len - 1
            : 0
          : event.shiftKey
            ? (currentIndex - 1 + len) % len
            : (currentIndex + 1) % len;
      controls[nextIndex]?.focus();
    }
  };

  const trimmedQuery = query.trim();
  const showNoResults = !loading && data !== undefined && items.length === 0 && trimmedQuery.length > 0;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog via keyboard.
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop scrim closes on click outside panel.
    <div
      className={styles.backdrop}
      data-search-scrim="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeWithFocusReturn();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t("rail.search")}
        onKeyDown={handlePanelKeyDown}
      >
        <div className={styles.header}>
          <span className={styles.inputIcon}>
            <Icon name="ring" />
          </span>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            role="combobox"
            aria-expanded={true}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            aria-label={t("search.placeholder")}
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
          />
        </div>
        <div id={listboxId} role="listbox" aria-label={t("rail.search")} className={styles.results}>
          {chats.length > 0 && (
            <div role="group" aria-labelledby={chatsHeadingId} className={styles.group}>
              <div id={chatsHeadingId} className={styles.groupHeading}>
                {data?.recent ? t("rail.recentChats") : t("search.chats")}
              </div>
              {chats.map((chat, index) => {
                const item = items[index];
                if (!item || item.kind !== "chat") return null;
                const optionId = `${listboxId}-${item.id}`;
                const isSelected = index === safeIndex;
                return (
                  <div
                    key={item.id}
                    id={optionId}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    data-result-kind="chat"
                    className={isSelected ? `${styles.item} ${styles.itemActive}` : styles.item}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectItem(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectItem(item);
                      }
                    }}
                  >
                    <div className={styles.itemTitle}>{chat.title}</div>
                    {(chat.snippet !== undefined || chat.outside) && (
                      <SafeText
                        text={chat.snippet ?? ""}
                        outside={chat.outside}
                        links="text"
                        className={styles.snippet}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {flows.length > 0 && (
            <div role="group" aria-labelledby={flowsHeadingId} className={styles.group}>
              <div id={flowsHeadingId} className={styles.groupHeading}>
                {t("search.flows")}
              </div>
              {flows.map((flow, flowIndex) => {
                const index = chats.length + flowIndex;
                const item = items[index];
                if (!item || item.kind !== "flow") return null;
                const optionId = `${listboxId}-${item.id}`;
                const isSelected = index === safeIndex;
                return (
                  <div
                    key={item.id}
                    id={optionId}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    data-result-kind="flow"
                    className={isSelected ? `${styles.item} ${styles.itemActive}` : styles.item}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectItem(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectItem(item);
                      }
                    }}
                  >
                    <div className={styles.itemTitle}>{flow.name}</div>
                    {flow.summary && flow.summary !== flow.name && (
                      <div className={styles.itemSummary}>{flow.summary}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {showNoResults && (
            <p className={styles.empty} role="status">
              {t("search.noResults", { query: trimmedQuery })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  if (!open) return null;
  return <SearchDialogPanel onClose={onClose} />;
}
