import type { Payload } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { formatUsd } from "../../ui/format";
import styles from "./Inbox.module.css";
import { splitHidden } from "./reveal";

function keyed<T>(values: T[], identity: (value: T) => string): { value: T; key: string }[] {
  const counts = new Map<string, number>();
  return values.map((value) => {
    const id = identity(value);
    const count = counts.get(id) ?? 0;
    counts.set(id, count + 1);
    return { value, key: JSON.stringify([id, count]) };
  });
}

export function Revealed({ text }: { text: string }): ReactElement {
  return (
    <>
      {keyed(splitHidden(text), (part) => part.text).map(({ value: part, key }) =>
        part.hidden ? (
          <mark
            key={key}
            className={styles.hidden}
          >{`<U+${(part.text.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}>`}</mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
function Recipients({ values }: { values: string[] }): ReactElement {
  return (
    <>
      {keyed(values.slice(0, 5), (value) => value).map(({ value, key }) => (
        <div key={key}>
          <Revealed text={value} />
        </div>
      ))}
      {values.length > 5 && <div>and {values.length - 5} more</div>}
    </>
  );
}
export function PayloadView({
  payload,
  editing,
  text,
  setText,
}: {
  payload: Payload;
  editing: boolean;
  text: string;
  setText: (value: string) => void;
}): ReactElement {
  const title = { email: "Email", post: "Post", diff: "Changes", amount: "Amount", text: "Text" }[
    payload.kind
  ];
  const editor = (
    <label className={styles.editor}>
      Edit the text
      <textarea value={text} onChange={(event) => setText(event.target.value)} />
    </label>
  );
  return (
    <section className={styles.payload}>
      <h3>{title}</h3>
      {payload.kind === "email" && (
        <>
          <dl className={styles.definitions}>
            <dt>To</dt>
            <dd>
              <Recipients values={payload.to} />
            </dd>
            {payload.cc && payload.cc.length > 0 && (
              <>
                <dt>Cc</dt>
                <dd>
                  <Recipients values={payload.cc} />
                </dd>
              </>
            )}
            <dt>Subject</dt>
            <dd>
              <Revealed text={payload.subject} />
            </dd>
          </dl>
          {editing ? (
            editor
          ) : (
            <pre>
              <Revealed text={payload.body} />
            </pre>
          )}
        </>
      )}
      {payload.kind === "post" && (
        <>
          <dl className={styles.definitions}>
            <dt>Platform</dt>
            <dd>
              <Revealed text={payload.platform} />
            </dd>
            <dt>Text</dt>
            <dd>{editing ? editor : <Revealed text={payload.text} />}</dd>
            <dt>Media</dt>
            <dd className={styles.mono}>
              {keyed(payload.media, (path) => path).map(({ value: path, key }) => (
                <div key={key}>
                  <Revealed text={path} />
                </div>
              ))}
            </dd>
          </dl>
        </>
      )}
      {payload.kind === "diff" &&
        keyed(payload.files, (file) => file.path).map(({ value: file, key }) => (
          <div key={key}>
            <div className={styles.mono}>
              <Revealed text={file.path} />
            </div>
            <div className={styles.patch}>
              {keyed(file.patch.split("\n"), (line) => line).map(({ value: line, key }) => (
                <div
                  key={key}
                  className={
                    line.startsWith("+") ? styles.added : line.startsWith("-") ? styles.removed : undefined
                  }
                >
                  <Revealed text={line} />
                </div>
              ))}
            </div>
          </div>
        ))}
      {payload.kind === "amount" && (
        <>
          <p>{formatUsd(payload.amountUsd)}</p>
          <p>
            <Revealed text={payload.description} />
          </p>
        </>
      )}
      {payload.kind === "text" &&
        (editing ? (
          editor
        ) : (
          <pre>
            <Revealed text={payload.text} />
          </pre>
        ))}
    </section>
  );
}
