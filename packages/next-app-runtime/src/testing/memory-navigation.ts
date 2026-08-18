import type { RuntimeLocation } from "../contract/types.js";
import type { NavigationDriver } from "../navigation/location.js";

function parse(href: string, base = "http://runtime.test/"): RuntimeLocation {
  const url = new URL(href, base);
  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    href: url.href,
  };
}

export interface MemoryNavigation extends NavigationDriver {
  back(): void;
  forward(): void;
}

export function createMemoryNavigation(initialHref = "/"): MemoryNavigation {
  const entries = [parse(initialHref)];
  let index = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const emit = () => {
    if (disposed) return;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => entries[index]!,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(href) {
      if (disposed) return;
      entries.splice(index + 1);
      entries.push(parse(href, entries[index]!.href));
      index += 1;
      emit();
    },
    replace(href) {
      if (disposed) return;
      entries[index] = parse(href, entries[index]!.href);
      emit();
    },
    back() {
      if (disposed) return;
      if (index > 0) {
        index -= 1;
        emit();
      }
    },
    forward() {
      if (disposed) return;
      if (index < entries.length - 1) {
        index += 1;
        emit();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
    },
  };
}
