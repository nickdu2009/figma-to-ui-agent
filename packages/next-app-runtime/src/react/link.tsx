import React from "react";
import type { ComponentRenderProps } from "@json-render/react";

import {
  isSameOriginHttpNavigationTarget,
  resolveBrowserNavigationTarget,
} from "../navigation/target.js";
import { useNextAppNavigation } from "./provider.js";

export interface LinkProps {
  href: string;
  replace?: boolean;
  prefetch?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Link({ element, children }: ComponentRenderProps<LinkProps>) {
  const { href, replace, className, style } = element.props;
  const navigation = useNextAppNavigation();
  const target = typeof href !== "string" || typeof window === "undefined"
    ? null
    : resolveBrowserNavigationTarget(href, window.location.href);
  const inert = target === null;
  return (
    <a
      href={inert ? undefined : href}
      role={inert ? "link" : undefined}
      aria-disabled={inert || undefined}
      className={className}
      style={style}
      onClick={(event) => {
        if (inert) {
          event.preventDefault();
          return;
        }
        const clickedTarget = resolveBrowserNavigationTarget(
          event.currentTarget.getAttribute("href") ?? "",
          window.location.href,
        );
        if (!clickedTarget) {
          event.preventDefault();
          return;
        }
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          (event.currentTarget.target !== "" &&
            event.currentTarget.target !== "_self") ||
          event.currentTarget.hasAttribute("download")
        ) {
          return;
        }
        if (!isSameOriginHttpNavigationTarget(clickedTarget, window.location.origin)) return;
        if (
          clickedTarget.pathname === window.location.pathname &&
          clickedTarget.search === window.location.search &&
          clickedTarget.hash
        ) {
          if (replace === true) {
            event.preventDefault();
            navigation.replace(clickedTarget.href);
          }
          return;
        }
        event.preventDefault();
        navigation[replace === true ? "replace" : "push"](clickedTarget.href);
      }}
    >
      {children}
    </a>
  );
}
