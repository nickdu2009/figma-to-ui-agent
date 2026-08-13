import {
  type NextAppRuntime,
  type NextAppSpec,
  type RuntimeErrorCode,
} from "@next-app-runtime/client";
import { catalog } from "./catalog";
import { defaultSpec } from "./default-spec";

export const SPEC_STORAGE_KEY = "next-app-runtime:website-builder:spec:v1";
export const SPEC_STORAGE_EVENT = "next-app-runtime:website-builder:spec-change";

export type StoredSpecResult =
  | { ok: true; spec: NextAppSpec; source: "default" | "storage" }
  | {
      ok: false;
      code: "stored_spec_contract_invalid" | "source_limit_exceeded";
      candidate: unknown;
    }
  | {
      ok: false;
      code: "stored_spec_parse_failed" | "stored_spec_read_failed";
    };

export type SpecCandidateResult =
  | { ok: true; spec: NextAppSpec; source: "storage" }
  | {
      ok: false;
      code: "stored_spec_contract_invalid" | "source_limit_exceeded";
      candidate: unknown;
    };

export type PreviewSpecResult =
  | { ok: true; spec: NextAppSpec }
  | {
      ok: false;
      code: "stored_spec_contract_invalid" | RuntimeErrorCode;
      candidate: unknown;
    };

export const WEBSITE_RUNTIME_LIMITS = {
  maxBytes: 5_000_000,
  maxOperations: 20_000,
  maxDepth: 200,
  maxRoutes: 1_000,
  maxElementsPerTree: 20_000,
} as const;

function exceedsMaxDepth(value: unknown, maxDepth: number): boolean {
  const deepestVisited = new WeakMap<object, number>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.value === null || typeof frame.value !== "object") continue;
    if (frame.depth > maxDepth) return true;
    const previousDepth = deepestVisited.get(frame.value);
    if (previousDepth !== undefined && previousDepth >= frame.depth) continue;
    deepestVisited.set(frame.value, frame.depth);
    for (const key of Object.keys(frame.value)) {
      const descriptor = Object.getOwnPropertyDescriptor(frame.value, key);
      if (descriptor && "value" in descriptor) {
        stack.push({ value: descriptor.value, depth: frame.depth + 1 });
      }
    }
  }
  return false;
}

export function validateSpecCandidate(candidate: unknown): SpecCandidateResult {
  if (exceedsMaxDepth(candidate, WEBSITE_RUNTIME_LIMITS.maxDepth)) {
    return { ok: false, code: "source_limit_exceeded", candidate };
  }
  const result = catalog.validate(candidate);
  return result.success
    ? { ok: true, spec: result.data as NextAppSpec, source: "storage" }
    : { ok: false, code: "stored_spec_contract_invalid", candidate };
}

export async function validatePreviewSpecCandidate(
  runtime: NextAppRuntime,
  candidate: unknown,
): Promise<PreviewSpecResult> {
  let parsed: SpecCandidateResult;
  try {
    parsed = validateSpecCandidate(candidate);
  } catch {
    return {
      ok: false,
      code: "stored_spec_contract_invalid",
      candidate,
    };
  }
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code,
      candidate,
    };
  }
  const result = await runtime.applySource({
    kind: "object",
    value: parsed.spec,
  });
  if (result.status === "rejected") {
    return {
      ok: false,
      code: result.error.code,
      candidate,
    };
  }
  return { ok: true, spec: runtime.getSnapshot().current! };
}

export function readSpec(storage?: Storage): StoredSpecResult {
  let stored: string | null;
  try {
    stored = (storage ?? window.localStorage).getItem(SPEC_STORAGE_KEY);
  } catch {
    return { ok: false, code: "stored_spec_read_failed" };
  }
  if (stored === null) {
    return { ok: true, spec: structuredClone(defaultSpec), source: "default" };
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(stored);
  } catch {
    return { ok: false, code: "stored_spec_parse_failed" };
  }
  try {
    return validateSpecCandidate(candidate);
  } catch {
    return {
      ok: false,
      code: "stored_spec_contract_invalid",
      candidate,
    };
  }
}

export function writeSpec(
  spec: unknown,
  storage?: Storage,
  eventTarget?: EventTarget,
): { ok: true } | { ok: false; code: "stored_spec_serialize_failed" } {
  try {
    (storage ?? window.localStorage).setItem(SPEC_STORAGE_KEY, JSON.stringify(spec));
    (eventTarget ?? window).dispatchEvent(new Event(SPEC_STORAGE_EVENT));
    return { ok: true };
  } catch {
    return { ok: false, code: "stored_spec_serialize_failed" };
  }
}

export function subscribeSpec(
  listener: () => void,
  host?: Window,
  storage?: Storage,
): () => void {
  let resolvedHost: Window;
  let resolvedStorage: Storage;
  try {
    resolvedHost = host ?? window;
    resolvedStorage = storage ?? resolvedHost.localStorage;
  } catch {
    return () => undefined;
  }
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === resolvedStorage && event.key === SPEC_STORAGE_KEY) listener();
  };
  resolvedHost.addEventListener("storage", onStorage);
  resolvedHost.addEventListener(SPEC_STORAGE_EVENT, listener);
  return () => {
    resolvedHost.removeEventListener("storage", onStorage);
    resolvedHost.removeEventListener(SPEC_STORAGE_EVENT, listener);
  };
}
