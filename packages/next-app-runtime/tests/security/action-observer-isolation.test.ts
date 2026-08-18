import {
  nextActionDispatchId,
  notifyActionDispatch,
  notifyActionSettle,
} from "@json-render/core";
import { describe, expect, it, vi } from "vitest";

import {
  registerRuntimeActionObserver,
  runWithRuntimeActionObserverScope,
  type RuntimeActionObserverRegistration,
} from "../../src/react/action-observer-manager.js";

function dispatch(name: string, registration?: RuntimeActionObserverRegistration): void {
  const id = nextActionDispatchId();
  const at = Date.now();
  runWithRuntimeActionObserverScope(registration ?? null, () => {
    notifyActionDispatch({ id, name, at });
  });
  notifyActionSettle({ id, name, at, durationMs: 0, ok: true });
}

describe("runtime action observer isolation", () => {
  it("attributes same-named actions to the active runtime scope", () => {
    const firstDispatch = vi.fn();
    const firstSettle = vi.fn();
    const secondDispatch = vi.fn();
    const first: RuntimeActionObserverRegistration = {
      actionNames: new Set(["setState"]),
      onDispatch: firstDispatch,
      onSettle: firstSettle,
    };
    const second: RuntimeActionObserverRegistration = {
      actionNames: new Set(["setState"]),
      onDispatch: secondDispatch,
    };
    const unregisterFirst = registerRuntimeActionObserver(first);
    const unregisterSecond = registerRuntimeActionObserver(second);

    dispatch("setState", first);
    expect(firstDispatch).toHaveBeenCalledOnce();
    expect(firstSettle).toHaveBeenCalledOnce();
    expect(secondDispatch).not.toHaveBeenCalled();

    dispatch("setState", second);
    expect(firstDispatch).toHaveBeenCalledOnce();
    expect(secondDispatch).toHaveBeenCalledOnce();

    dispatch("setState");
    expect(firstDispatch).toHaveBeenCalledOnce();
    expect(secondDispatch).toHaveBeenCalledOnce();

    unregisterSecond();
    unregisterFirst();
  });

  it("fails closed for unscoped and watch-style action emissions", () => {
    const firstDispatch = vi.fn();
    const secondDispatch = vi.fn();
    const first: RuntimeActionObserverRegistration = {
      actionNames: new Set(["save"]),
      onDispatch: firstDispatch,
    };
    const second: RuntimeActionObserverRegistration = {
      actionNames: new Set(["publish"]),
      onDispatch: secondDispatch,
    };
    const unregisterFirst = registerRuntimeActionObserver(first);
    const unregisterSecond = registerRuntimeActionObserver(second);

    dispatch("publish", second);
    expect(firstDispatch).not.toHaveBeenCalled();
    expect(secondDispatch).toHaveBeenCalledOnce();
    dispatch("publish");
    expect(firstDispatch).not.toHaveBeenCalled();
    expect(secondDispatch).toHaveBeenCalledOnce();
    unregisterSecond();
    unregisterFirst();
  });
});
