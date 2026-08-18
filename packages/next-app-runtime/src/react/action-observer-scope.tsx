import { createContext, useContext, type ReactNode } from "react";

import type { RuntimeActionObserverRegistration } from "./action-observer-manager.js";

const RuntimeActionObserverContext = createContext<RuntimeActionObserverRegistration | null>(null);

export function RuntimeActionObserverScope({
  registration,
  children,
}: {
  registration: RuntimeActionObserverRegistration | null;
  children: ReactNode;
}) {
  return (
    <RuntimeActionObserverContext.Provider value={registration}>
      {children}
    </RuntimeActionObserverContext.Provider>
  );
}

export function useRuntimeActionObserverScope(): RuntimeActionObserverRegistration | null {
  return useContext(RuntimeActionObserverContext);
}
