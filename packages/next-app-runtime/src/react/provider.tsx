import React, { createContext, useContext, type ReactNode } from "react";
import type { ComponentRegistry } from "@json-render/react";

import type { NextAppRuntime } from "../contract/types.js";
import { navigateBrowser } from "../navigation/browser-history.js";
import type { NavigationDriver } from "../navigation/location.js";

export interface NextAppContextValue {
  registry: ComponentRegistry;
  handlers?: Record<
    string,
    (params: Record<string, unknown>) => Promise<unknown> | unknown
  >;
  navigate: (href: string) => void;
}

const NextAppContext = createContext<NextAppContextValue | null>(null);
const RuntimeContext = createContext<NextAppRuntime | null>(null);
const NavigationContext = createContext<Pick<NavigationDriver, "push" | "replace"> | null>(null);

export interface NextAppProviderProps {
  registry: ComponentRegistry;
  handlers?: Record<
    string,
    (params: Record<string, unknown>) => Promise<unknown> | unknown
  >;
  children: ReactNode;
}

export function NextAppProvider({ registry, handlers, children }: NextAppProviderProps) {
  const navigate = React.useCallback((href: string) => navigateBrowser(href), []);
  const value = React.useMemo(
    () => ({ registry, handlers, navigate }),
    [registry, handlers, navigate],
  );
  const navigation = React.useMemo(
    () => ({
      push: (href: string) => navigateBrowser(href),
      replace: (href: string) => navigateBrowser(href, true),
    }),
    [],
  );
  return (
    <NavigationContext.Provider value={navigation}>
      <NextAppContext.Provider value={value}>{children}</NextAppContext.Provider>
    </NavigationContext.Provider>
  );
}

export function RuntimeNextAppProvider({
  registry,
  handlers,
  navigation,
  children,
}: NextAppProviderProps & { navigation: NavigationDriver }) {
  const navigate = React.useCallback((href: string) => navigation.push(href), [navigation]);
  const value = React.useMemo(
    () => ({ registry, handlers, navigate }),
    [registry, handlers, navigate],
  );
  return (
    <NavigationContext.Provider value={navigation}>
      <NextAppContext.Provider value={value}>{children}</NextAppContext.Provider>
    </NavigationContext.Provider>
  );
}

export function useNextAppNavigation() {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("Link must be used within NextAppProvider");
  return navigation;
}

export function useNextApp(): NextAppContextValue {
  const value = useContext(NextAppContext);
  if (!value) {
    throw new Error("useNextApp must be used within NextAppProvider");
  }
  return value;
}

export interface NextAppRuntimeProviderProps {
  runtime: NextAppRuntime;
  children: ReactNode;
}

export function NextAppRuntimeProvider({ runtime, children }: NextAppRuntimeProviderProps) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useNextAppRuntime(): NextAppRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("useNextAppRuntime must be used within NextAppRuntimeProvider");
  return runtime;
}
