import {
  registerActionObserver,
  type ActionDispatchInfo,
  type ActionSettleInfo,
} from "@json-render/core";

export interface RuntimeActionObserverRegistration {
  actionNames: ReadonlySet<string>;
  onDispatch?: (event: ActionDispatchInfo) => void;
  onSettle?: (event: ActionSettleInfo) => void;
}

const registrations = new Set<RuntimeActionObserverRegistration>();
const dispatchOwners = new Map<string, RuntimeActionObserverRegistration>();
let unregisterCoreObserver: (() => void) | null = null;
let activeRegistration: RuntimeActionObserverRegistration | null = null;

function ensureCoreObserver(): void {
  if (unregisterCoreObserver) return;
  unregisterCoreObserver = registerActionObserver({
    onDispatch(event) {
      const owner = activeRegistration;
      // @json-render/core 0.19.0 emits process-global action events without a
      // provider identity. Only a component emission carrying an exact local
      // runtime scope may claim it; watch/chained/external emissions fail
      // closed because action-name matching cannot establish ownership.
      if (!owner || !registrations.has(owner) || !owner.actionNames.has(event.name)) return;
      dispatchOwners.set(event.id, owner);
      owner.onDispatch?.(event);
    },
    onSettle(event) {
      const owner = dispatchOwners.get(event.id);
      dispatchOwners.delete(event.id);
      owner?.onSettle?.(event);
    },
  });
}

export function runWithRuntimeActionObserverScope(
  registration: RuntimeActionObserverRegistration | null,
  callback: () => void,
): void {
  if (!registration || !registrations.has(registration)) {
    callback();
    return;
  }
  const previous = activeRegistration;
  activeRegistration = registration;
  try {
    callback();
  } finally {
    activeRegistration = previous;
  }
}

export function registerRuntimeActionObserver(
  registration: RuntimeActionObserverRegistration,
): () => void {
  registrations.add(registration);
  ensureCoreObserver();
  return () => {
    registrations.delete(registration);
    if (activeRegistration === registration) activeRegistration = null;
    for (const [id, owner] of dispatchOwners) {
      if (owner === registration) dispatchOwners.delete(id);
    }
    if (registrations.size === 0) {
      unregisterCoreObserver?.();
      unregisterCoreObserver = null;
      dispatchOwners.clear();
    }
  };
}
