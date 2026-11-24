import type { ChatSummary } from "@flowdriven/contracts";
import { type ReactElement, useId } from "react";
import { AppLink } from "../nav/AppLink";
import type { Route } from "../nav/route";
import { useRunnerQuery } from "../runner/runner-context";
import styles from "./ChatList.module.css";
import { useLanguage } from "./language";

export type ChatGroupKey = "today" | "yesterday" | "earlier";

export type ChatGroup = {
  key: ChatGroupKey;
  chats: ChatSummary[];
};

function localDayIndex(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(ms));
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "1970");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function groupChats(chats: readonly ChatSummary[], nowMs: number, zone: string): ChatGroup[] {
  const todayIndex = localDayIndex(nowMs, zone);
  const buckets: Record<ChatGroupKey, ChatSummary[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };
  const sorted = [...chats].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const chat of sorted) {
    const diff = todayIndex - localDayIndex(Date.parse(chat.updatedAt), zone);
    if (diff <= 0) buckets.today.push(chat);
    else if (diff === 1) buckets.yesterday.push(chat);
    else buckets.earlier.push(chat);
  }
  const order: readonly ChatGroupKey[] = ["today", "yesterday", "earlier"];
  return order.flatMap((key) => (buckets[key].length > 0 ? [{ key, chats: buckets[key] }] : []));
}

export function ChatList({
  route,
  now = Date.now,
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
}: {
  route: Route;
  now?: () => number;
  zone?: string;
}): ReactElement {
  const { t } = useLanguage();
  const baseId = useId();
  const { data } = useRunnerQuery("chats.list", {});
  const groups = groupChats(data ?? [], now(), zone);

  const groupLabel = (key: ChatGroupKey): string => {
    switch (key) {
      case "today":
        return t("time.today");
      case "yesterday":
        return t("time.yesterday");
      case "earlier":
        return t("activity.earlier");
    }
  };

  return (
    <div className={styles.groups}>
      {groups.map((group) => {
        const headingId = `${baseId}-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId} className={styles.group}>
            <h2 id={headingId} className={styles.groupHeading}>
              {groupLabel(group.key)}
            </h2>
            <ul className={styles.list}>
              {group.chats.map((chat) => {
                const isCurrent = route.screen === "chat" && route.chatId === chat.id;
                return (
                  <li key={chat.id}>
                    <AppLink
                      to={{ screen: "chat", chatId: chat.id }}
                      className={styles.chatLink}
                      aria-current={isCurrent ? "page" : undefined}
                      title={chat.title}
                    >
                      <span className={styles.chatTitle}>{chat.title}</span>
                    </AppLink>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
