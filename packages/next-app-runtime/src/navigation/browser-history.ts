import { NAVIGATION_EVENT, toRuntimeLocation, type NavigationDriver } from "./location.js";
import {
  isSameOriginHttpNavigationTarget,
  resolveBrowserNavigationTarget,
} from "./target.js";

interface PendingHashScroll {
  href: string;
  targetId: string;
}

let pendingHashScroll: PendingHashScroll | null = null;

function decodeHashTarget(hash: string): string {
  const encoded = hash.slice(1);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export function completeBrowserNavigationScroll(href: string): void {
  const pending = pendingHashScroll;
  if (!pending || pending.href !== href || window.location.href !== href) return;
  const target = document.getElementById(pending.targetId);
  if (!target) return;
  pendingHashScroll = null;
  target.scrollIntoView();
}

export function notifyBrowserNavigation(): void {
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

export function navigateBrowser(href: string, replace = false): void {
  const target = resolveBrowserNavigationTarget(href, window.location.href);
  if (!target) return;
  if (!isSameOriginHttpNavigationTarget(target, window.location.origin)) {
    window.location.assign(target.href);
    return;
  }
  const sameDocument =
    target.pathname === window.location.pathname && target.search === window.location.search;
  pendingHashScroll = target.hash
    ? { href: target.href, targetId: decodeHashTarget(target.hash) }
    : null;
  window.history[replace ? "replaceState" : "pushState"](
    null,
    "",
    `${target.pathname}${target.search}${target.hash}`,
  );
  notifyBrowserNavigation();
  if (target.hash) {
    if (sameDocument) {
      window.requestAnimationFrame(() => completeBrowserNavigationScroll(target.href));
    }
  } else {
    window.scrollTo({ top: 0, left: 0 });
  }
}

export function createBrowserHistoryDriver(): NavigationDriver {
  if (typeof window === "undefined") {
    throw new Error("Browser History navigation requires window");
  }
  let snapshot = toRuntimeLocation(window.location);
  let disposed = false;
  const listeners = new Set<() => void>();
  const update = () => {
    if (disposed) return;
    const next = toRuntimeLocation(window.location);
    if (
      next.pathname === snapshot.pathname &&
      next.search === snapshot.search &&
      next.hash === snapshot.hash &&
      next.href === snapshot.href
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  };
  window.addEventListener("popstate", update);
  window.addEventListener(NAVIGATION_EVENT, update);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(href) {
      if (disposed) return;
      navigateBrowser(href, false);
    },
    replace(href) {
      if (disposed) return;
      navigateBrowser(href, true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATION_EVENT, update);
      listeners.clear();
    },
  };
}
