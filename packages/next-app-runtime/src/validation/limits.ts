import type { Spec } from "@json-render/core";

import {
  RuntimeError,
  type NextAppSpec,
  type RuntimeLimits,
} from "../contract/types.js";

const LIMIT_NAMES = [
  "maxBytes",
  "maxOperations",
  "maxDepth",
  "maxRoutes",
  "maxElementsPerTree",
] as const satisfies readonly (keyof RuntimeLimits)[];

export function assertPositiveRuntimeLimit(
  name: keyof RuntimeLimits,
  value: number,
): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RuntimeError(
      "source_limit_exceeded",
      "Runtime limits must be positive safe integers",
      { limit: name },
    );
  }
}

export function assertRuntimeLimitConfig(limits: RuntimeLimits): void {
  for (const name of LIMIT_NAMES) assertPositiveRuntimeLimit(name, limits[name]);
}

export function assertRuntimeInputDepth(value: unknown, limits: RuntimeLimits): void {
  assertPositiveRuntimeLimit("maxDepth", limits.maxDepth);
  const active = new WeakSet<object>();
  const deepestVisited = new WeakMap<object, number>();
  const stack: Array<{ value: unknown; depth: number; exit?: boolean }> = [
    { value, depth: 0 },
  ];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const input = frame.value;
    if (input === null || typeof input !== "object") continue;
    if (frame.exit) {
      active.delete(input);
      continue;
    }
    if (frame.depth > limits.maxDepth) {
      throw new RuntimeError("source_limit_exceeded", "Spec exceeds maxDepth");
    }
    if (active.has(input)) continue;
    const previousDepth = deepestVisited.get(input);
    if (previousDepth !== undefined && previousDepth >= frame.depth) continue;
    deepestVisited.set(input, frame.depth);
    active.add(input);
    stack.push({ value: input, depth: frame.depth, exit: true });
    const keys = Object.keys(input);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, keys[index]!);
      if (descriptor && "value" in descriptor) {
        stack.push({ value: descriptor.value, depth: frame.depth + 1 });
      }
    }
  }
}

function assertTreeLimit(tree: Spec, limits: RuntimeLimits): void {
  if (Object.keys(tree.elements).length > limits.maxElementsPerTree) {
    throw new RuntimeError(
      "source_limit_exceeded",
      "Element tree exceeds maxElementsPerTree",
    );
  }
}

export function assertRuntimeLimits(
  spec: NextAppSpec,
  limits: RuntimeLimits,
): void {
  assertRuntimeLimitConfig(limits);
  if (Object.keys(spec.routes).length > limits.maxRoutes) {
    throw new RuntimeError("source_limit_exceeded", "Spec exceeds maxRoutes");
  }
  assertRuntimeInputDepth(spec, limits);
  for (const route of Object.values(spec.routes)) {
    assertTreeLimit(route.page, limits);
    if (route.loading) assertTreeLimit(route.loading, limits);
    if (route.error) assertTreeLimit(route.error, limits);
    if (route.notFound) assertTreeLimit(route.notFound, limits);
  }
  for (const layout of Object.values(spec.layouts ?? {})) {
    assertTreeLimit(layout, limits);
  }
}
