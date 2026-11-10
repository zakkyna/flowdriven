import type { AnchorHTMLAttributes, ReactElement } from "react";
import { type Route, routeToHash, useRoute } from "./route";
export function AppLink({
  to,
  onClick,
  ...props
}: { to: Route } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">): ReactElement {
  const [, navigate] = useRoute();
  return (
    <a
      {...props}
      href={routeToHash(to)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          event.preventDefault();
          navigate(to);
        }
      }}
    />
  );
}
