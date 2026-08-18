import type {
  NavigationDriver,
  RuntimeLocation,
} from "@next-app-runtime/client";

function toLocation(href: string, base = "http://preview.local/"): RuntimeLocation {
  const url = new URL(href, base);
  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    href: url.href,
  };
}

/**
 * The generated app is rendered inside the host application's preview pane.
 * Its Link components must therefore update only the runtime route, never the
 * host application's address bar or browser history.
 */
export interface PreviewNavigation extends NavigationDriver {
  back(): void;
  forward(): void;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

export function createPreviewNavigation(initialHref = "/"): PreviewNavigation {
  const entries = [toLocation(initialHref)];
  let index = 0;
  let disposed = false;
  const listeners = new Set<() => void>();

  const publish = () => {
    if (disposed) return;
    for (const listener of listeners) listener();
  };

  const navigate = (href: string) => {
    if (disposed) return;
    entries.splice(index + 1);
    entries.push(toLocation(href, entries[index]!.href));
    index += 1;
    publish();
  };

  return {
    getSnapshot: () => entries[index]!,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push: navigate,
    replace(href) {
      if (disposed) return;
      entries[index] = toLocation(href, entries[index]!.href);
      publish();
    },
    back() {
      if (disposed || index === 0) return;
      index -= 1;
      publish();
    },
    forward() {
      if (disposed || index === entries.length - 1) return;
      index += 1;
      publish();
    },
    reload() {
      publish();
    },
    canGoBack: () => index > 0,
    canGoForward: () => index < entries.length - 1,
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
    },
  };
}
