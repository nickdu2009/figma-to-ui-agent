import type { RuntimeLocation } from "../contract/types.js";

export interface NavigationDriver {
  getSnapshot(): RuntimeLocation;
  subscribe(listener: () => void): () => void;
  push(href: string): void;
  replace(href: string): void;
  dispose(): void;
}

export const NAVIGATION_EVENT = "next-app-runtime:navigate";

export function toRoutePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function toRuntimeLocation(location: Location): RuntimeLocation {
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    href: location.href,
  };
}
