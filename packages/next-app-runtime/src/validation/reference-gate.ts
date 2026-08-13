import type { Spec } from "@json-render/core";

import { RuntimeError, type NextAppSpec } from "../contract/types.js";

function validateTree(
  tree: Spec,
  componentNames: ReadonlySet<string>,
  context: string,
): { hasSlot: boolean } {
  if (!Object.prototype.hasOwnProperty.call(tree.elements, tree.root)) {
    throw new RuntimeError("references_invalid", "Element tree root is missing", {
      context,
    });
  }
  for (const [key, element] of Object.entries(tree.elements)) {
    if (
      element.type !== "Slot" &&
      element.type !== "Link" &&
      !componentNames.has(element.type)
    ) {
      throw new RuntimeError("references_invalid", "Element type is not in the catalog", {
        context,
        key,
        type: element.type,
      });
    }
    for (const child of element.children ?? []) {
      if (!Object.prototype.hasOwnProperty.call(tree.elements, child)) {
        throw new RuntimeError("references_invalid", "Element child reference is missing", {
          context,
          key,
          child,
        });
      }
    }
  }
  const visiting = new Set<string>();
  const reachable = new Set<string>();
  const stack: Array<{ key: string; exiting: boolean }> = [
    { key: tree.root, exiting: false },
  ];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.exiting) {
      visiting.delete(frame.key);
      reachable.add(frame.key);
      continue;
    }
    if (reachable.has(frame.key)) continue;
    if (visiting.has(frame.key)) {
      throw new RuntimeError("references_invalid", "Element child references contain a cycle", {
        context,
        key: frame.key,
      });
    }
    visiting.add(frame.key);
    stack.push({ key: frame.key, exiting: true });
    const children = tree.elements[frame.key]?.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ key: children[index]!, exiting: false });
    }
  }
  return {
    hasSlot: [...reachable].some((key) => tree.elements[key]?.type === "Slot"),
  };
}

export function assertReferences(
  spec: NextAppSpec,
  componentNames: readonly string[],
  actionNames: readonly string[],
): void {
  const names = new Set(componentNames);
  const actions = new Set([
    ...actionNames,
    "navigate",
    "setState",
    "pushState",
    "removeState",
  ]);
  const referencedLayouts = new Set(
    Object.values(spec.routes)
      .map((route) => route.layout)
      .filter((layout): layout is string => layout !== undefined),
  );
  const validateActions = (tree: Spec, context: string) => {
    for (const [key, element] of Object.entries(tree.elements)) {
      for (const bindings of [element.on, element.watch]) {
        for (const value of Object.values(bindings ?? {})) {
          for (const binding of Array.isArray(value) ? value : [value]) {
            if (!actions.has(binding.action)) {
              throw new RuntimeError("references_invalid", "Action is not in the catalog", {
                context,
                key,
                action: binding.action,
              });
            }
            for (const followUp of [binding.onSuccess, binding.onError]) {
              if (followUp && "action" in followUp && !actions.has(followUp.action)) {
                throw new RuntimeError("references_invalid", "Chained action is not in the catalog", {
                  context,
                  key,
                  action: followUp.action,
                });
              }
            }
          }
        }
      }
    }
  };
  for (const [name, layout] of Object.entries(spec.layouts ?? {})) {
    const result = validateTree(layout, names, `layout:${name}`);
    validateActions(layout, `layout:${name}`);
    if (referencedLayouts.has(name) && !result.hasSlot) {
      throw new RuntimeError("slot_missing", "Referenced layout must contain Slot", {
        layout: name,
      });
    }
  }
  for (const [pattern, route] of Object.entries(spec.routes)) {
    validateTree(route.page, names, `route:${pattern}:page`);
    validateActions(route.page, `route:${pattern}:page`);
    if (route.loading) {
      validateTree(route.loading, names, `route:${pattern}:loading`);
      validateActions(route.loading, `route:${pattern}:loading`);
    }
    if (route.error) {
      validateTree(route.error, names, `route:${pattern}:error`);
      validateActions(route.error, `route:${pattern}:error`);
    }
    if (route.notFound) {
      validateTree(route.notFound, names, `route:${pattern}:notFound`);
      validateActions(route.notFound, `route:${pattern}:notFound`);
    }
    if (route.layout && !Object.prototype.hasOwnProperty.call(spec.layouts ?? {}, route.layout)) {
      throw new RuntimeError("layout_missing", "Route references a missing layout", {
        pattern,
        layout: route.layout,
      });
    }
  }
}
