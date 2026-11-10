import type { ChatMessage } from "@flowdriven/contracts";
import { type ReactElement, useState } from "react";
import { Button } from "../../ui/Button";
import { formatDateTime } from "../../ui/format";
import styles from "./Builder.module.css";
export function ChatPanel({
  messages,
  send,
}: {
  messages: ChatMessage[];
  send: (message: string) => Promise<boolean>;
}): ReactElement {
  const [message, setMessage] = useState("");
  const submit = async (value: string) => {
    if (value.trim() && (await send(value.trim()))) setMessage("");
  };
  return (
    <aside aria-label="Chat" className={styles.chat}>
      <header>
        <h2>Chat</h2>
        <p className={styles.muted}>Describe changes in your own words.</p>
      </header>
      <div className={styles.messages}>
        {messages.map((item) => (
          <div className={styles.message} key={item.id}>
            <div>
              <strong>{item.role === "user" ? "You" : "FlowDriven"}</strong>{" "}
              <time dateTime={item.at}>{formatDateTime(item.at)}</time>
            </div>
            <p className={styles.prewrap}>{item.text}</p>
            {item.questions?.map((question) => (
              <div key={question.id}>
                <p>{question.text}</p>
                <div className={styles.suggestions}>
                  {question.suggestions.map((suggestion) => (
                    <Button key={suggestion} onClick={() => void submit(suggestion)}>
                      {suggestion}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className={styles.composer}>
        <textarea
          rows={3}
          aria-label="Message"
          placeholder="Describe a change, or new work to turn into a flow"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.metaKey && event.key === "Enter") {
              event.preventDefault();
              void submit(message);
            }
          }}
        />
        <Button disabled={!message.trim()} onClick={() => void submit(message)}>
          Send
        </Button>
      </div>
    </aside>
  );
}
