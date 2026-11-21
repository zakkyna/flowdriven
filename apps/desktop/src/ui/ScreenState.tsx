import type { RunnerError } from "@flowdriven/contracts/v1";
import type { ReactElement } from "react";
import { Button } from "./Button";
import { Page } from "./Page";
export function ScreenState({
  screen,
  title,
  description,
  loading,
  error,
  reload,
}: {
  screen: string;
  title: string;
  description?: string;
  loading: boolean;
  error: RunnerError | undefined;
  reload: () => void;
}): ReactElement {
  return (
    <Page screen={screen} ready={false} title={title} description={description}>
      {loading ? (
        <p role="status">Loading</p>
      ) : (
        <>
          <p role="alert">{error?.message}</p>
          <Button variant="quiet" onClick={reload}>
            Try again
          </Button>
        </>
      )}
    </Page>
  );
}
