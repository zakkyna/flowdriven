import type { WindowReply } from "@flowdriven/contracts";
import { Fragment, type ReactElement, type ReactNode, useCallback, useMemo } from "react";
import { splitHidden } from "../screens/inbox/reveal";
import { useLanguage } from "../shell/language";
import { useToast } from "../ui/Toast";
import styles from "./SafeText.module.css";

export type SafeTextProps = {
  text: string;
  outside?: boolean;
  links?: "text" | "clickable";
  className?: string;
};

type Segment =
  | { kind: "text"; text: string; offset: number }
  | { kind: "hidden"; text: string; offset: number }
  | { kind: "link"; text: string; offset: number };

type WindowWithShell = Window & {
  flowdrivenShell?: {
    window?: {
      openLink?: (url: string) => Promise<WindowReply<{ opened: boolean }>>;
    };
  };
};

const trailingPunctuation = new Set([".", ",", ";", ":", "!", "?"]);

function formatHiddenChar(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  return `[U+${code.toString(16).toUpperCase().padStart(4, "0")} hidden character]`;
}

function hasUnmatchedClosingParen(value: string): boolean {
  let open = 0;
  let close = 0;
  for (const ch of value) {
    if (ch === "(") open += 1;
    else if (ch === ")") close += 1;
  }
  return close > open;
}

function trimUrlCandidate(raw: string): { url: string; trailing: string } {
  let end = raw.length;
  while (end > 0) {
    const candidate = raw.slice(0, end);
    const last = candidate.slice(-1);
    if (trailingPunctuation.has(last) || (last === ")" && hasUnmatchedClosingParen(candidate))) {
      end -= 1;
      continue;
    }
    break;
  }
  return { url: raw.slice(0, end), trailing: raw.slice(end) };
}

function isValidHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function buildSegments(text: string, clickableLinks: boolean): Segment[] {
  const parts = splitHidden(text);
  const segments: Segment[] = [];
  let offset = 0;

  for (const part of parts) {
    if (part.hidden) {
      segments.push({ kind: "hidden", text: formatHiddenChar(part.text), offset });
      offset += part.text.length;
      continue;
    }

    if (!clickableLinks) {
      segments.push({ kind: "text", text: part.text, offset });
      offset += part.text.length;
      continue;
    }

    const urlPattern = /\bhttps:\/\/[^\s<>"'`]+/gi;
    let cursor = 0;
    for (const match of part.text.matchAll(urlPattern)) {
      const matchIndex = match.index ?? 0;
      const raw = match[0];
      const { url, trailing } = trimUrlCandidate(raw);
      if (!isValidHttpsUrl(url)) {
        continue;
      }
      if (matchIndex > cursor) {
        segments.push({ kind: "text", text: part.text.slice(cursor, matchIndex), offset: offset + cursor });
      }
      segments.push({ kind: "link", text: url, offset: offset + matchIndex });
      if (trailing.length > 0) {
        segments.push({
          kind: "text",
          text: trailing,
          offset: offset + matchIndex + url.length,
        });
      }
      cursor = matchIndex + raw.length;
    }

    if (cursor < part.text.length) {
      segments.push({ kind: "text", text: part.text.slice(cursor), offset: offset + cursor });
    }
    offset += part.text.length;
  }

  return segments;
}

async function requestOpenLink(url: string): Promise<boolean> {
  const openLink = (window as WindowWithShell).flowdrivenShell?.window?.openLink;
  if (typeof openLink !== "function") return false;
  try {
    const reply = await openLink(url);
    return typeof reply === "object" && reply !== null && reply.ok === true && reply.result.opened === true;
  } catch {
    return false;
  }
}

export function SafeText({ text, outside = false, links = "text", className }: SafeTextProps): ReactElement {
  const { t } = useLanguage();
  const toast = useToast();

  const handleOpen = useCallback(
    async (url: string) => {
      const opened = await requestOpenLink(url);
      if (!opened) {
        toast(t("text.linkNotOpened"));
      }
    },
    [toast, t],
  );

  const segments = useMemo(() => buildSegments(text, links === "clickable"), [text, links]);

  const nodes: ReactNode[] = segments.map((segment) => {
    if (segment.kind === "hidden") {
      return (
        <span key={`h-${segment.offset}`} className={styles.hidden}>
          {segment.text}
        </span>
      );
    }
    if (segment.kind === "link") {
      return (
        <button
          key={`l-${segment.offset}`}
          type="button"
          role="link"
          className={styles.link}
          onClick={(event) => {
            event.preventDefault();
            void handleOpen(segment.text);
          }}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              void handleOpen(segment.text);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleOpen(segment.text);
            }
          }}
        >
          {segment.text}
        </button>
      );
    }
    return <Fragment key={`t-${segment.offset}`}>{segment.text}</Fragment>;
  });

  const body = (
    <div
      className={outside ? styles.body : className ? `${styles.body} ${className}` : styles.body}
      data-wrap="pre"
      style={{ whiteSpace: "pre-wrap" }}
    >
      {nodes}
    </div>
  );

  if (!outside) {
    return body;
  }

  return (
    <div className={className ? `${styles.root} ${className}` : styles.root}>
      <div className={styles.outsideTag} data-outside-tag="true">
        {t("text.outsideTag")}
      </div>
      {body}
    </div>
  );
}
