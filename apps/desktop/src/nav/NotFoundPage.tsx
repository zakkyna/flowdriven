import type { ReactElement } from "react";
import { Page } from "../ui/Page";
import { AppLink } from "./AppLink";
import type { Route } from "./route";
export function NotFoundPage({
  screen,
  title,
  text,
  linkLabel,
  to,
}: {
  screen: string;
  title: string;
  text: string;
  linkLabel: string;
  to: Route;
}): ReactElement {
  return (
    <Page screen={screen} ready title={title} description={text}>
      <AppLink to={to}>{linkLabel}</AppLink>
    </Page>
  );
}
