import type { ChatMessage } from "@flowdriven/contracts/v1";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { formatDateTime } from "../../ui/format";
import { Icon } from "../../ui/icons";
import styles from "./Builder.module.css";
export function ChatPanel({
  messages,
  send,
}: {
  messages: ChatMessage[];
  send: (message: string) => Promise<boolean>;
}): ReactElement {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const messagesBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = messagesBox.current;
    if (box && messages.length) box.scrollTop = box.scrollHeight;
  }, [messages]);
  const submit = async (value: string, clearDraft = false) => {
    if (!value.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const ok = await send(value.trim());
    inFlight.current = false;
    setBusy(false);
    if (ok && clearDraft) setMessage((draft) => (draft === value ? "" : draft));
  };
  return (
    <section aria-label="Chat" className={styles.chat}>
      <header className={styles.bar}>
        <h2>Chat</h2>
      </header>
      <div className={styles.threadScroll} data-scroll="bottom" ref={messagesBox}>
        <div className={styles.thread}>
          {messages.length === 0 && <p>Describe changes in your own words.</p>}
          {messages.map((item) => (
            <div className={`${styles.message} ${item.role === "user" ? styles.user : ""}`} key={item.id}>
              <span className={styles.visuallyHidden}>
                {item.role === "user" ? "You" : "FlowDriven"}, {formatDateTime(item.at)}:{" "}
              </span>
              <div className={item.role === "user" ? styles.bubble : styles.agent}>
                <p>{item.text}</p>
                {item.questions && item.questions.length > 0 && (
                  <ol className={styles.questions}>
                    {item.questions.map((question) => (
                      <li key={question.id}>
                        {question.text}
                        <div className={styles.chips} role="group" aria-label={`Answers to ${question.text}`}>
                          {question.suggestions.map((suggestion) => (
                            <button
                              className={styles.chip}
                              type="button"
                              key={suggestion}
                              disabled={busy}
                              onClick={() => void submit(suggestion)}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.dock}>
        <div className={styles.composer}>
          <textarea
            rows={2}
            aria-label="Message"
            placeholder="Describe a change, or new work to turn into a flow"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.metaKey && event.key === "Enter") {
                event.preventDefault();
                void submit(message, true);
              }
            }}
          />
          <div className={styles.composerRow}>
            <button
              className={styles.send}
              type="button"
              aria-label="Send"
              disabled={busy || !message.trim()}
              onClick={() => void submit(message, true)}
            >
              <Icon name="arrow-up" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
