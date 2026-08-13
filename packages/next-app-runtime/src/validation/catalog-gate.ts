import type { Catalog } from "@json-render/core";
import type { Spec } from "@json-render/core";
import type { ComponentRegistry } from "@json-render/react";
import { z, type ZodType } from "zod";

import { RuntimeError, type NextAppSpec } from "../contract/types.js";
import { expressionAwareCatalogSchema } from "../contract/zod-schema.js";

const BUILT_IN_COMPONENTS = new Set(["Slot", "Link"]);
const RESERVED_ACTIONS = new Set([
  "navigate",
  "setState",
  "pushState",
  "removeState",
]);

interface CatalogEntry {
  props?: ZodType;
  params?: ZodType;
}

function catalogData(catalog: Catalog): {
  components: Record<string, CatalogEntry>;
  actions: Record<string, CatalogEntry>;
} {
  const data = catalog.data as {
    components?: Record<string, CatalogEntry>;
    actions?: Record<string, CatalogEntry>;
  };
  return {
    components: data.components ?? {},
    actions: data.actions ?? {},
  };
}

const linkPropsSchema = z
  .object({
    href: z.string(),
    replace: z.boolean().optional(),
    prefetch: z.boolean().optional(),
    className: z.string().optional(),
    style: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const expressionAwareLinkPropsSchema = expressionAwareCatalogSchema(linkPropsSchema);

function trees(spec: NextAppSpec): Spec[] {
  const result = [...Object.values(spec.layouts ?? {})];
  for (const route of Object.values(spec.routes)) {
    result.push(route.page);
    if (route.loading) result.push(route.loading);
    if (route.error) result.push(route.error);
    if (route.notFound) result.push(route.notFound);
  }
  return result;
}

export function assertCatalogAndRegistry(
  catalog: Catalog,
  registry: ComponentRegistry,
  handlers: Readonly<Record<string, unknown>> | undefined,
): void {
  for (const name of BUILT_IN_COMPONENTS) {
    if (Object.prototype.hasOwnProperty.call(registry, name)) {
      throw new RuntimeError(
        "reserved_name_conflict",
        "Registry contains a reserved component name",
        { name },
      );
    }
  }
  for (const name of RESERVED_ACTIONS) {
    if (handlers && Object.prototype.hasOwnProperty.call(handlers, name)) {
      throw new RuntimeError(
        "reserved_name_conflict",
        "Handlers contain a reserved action name",
        { name },
      );
    }
  }
  const declared = [...catalog.componentNames].sort();
  const implemented = Object.keys(registry).sort();
  if (
    declared.length !== implemented.length ||
    declared.some((name, index) => name !== implemented[index])
  ) {
    throw new RuntimeError(
      "catalog_registry_mismatch",
      "Catalog components and registry implementations do not match",
      { declared, implemented },
    );
  }
  const declaredActions = [...catalog.actionNames].sort();
  const implementedActions = Object.keys(handlers ?? {}).sort();
  if (
    declaredActions.length !== implementedActions.length ||
    declaredActions.some((name, index) => name !== implementedActions[index])
  ) {
    throw new RuntimeError(
      "catalog_registry_mismatch",
      "Catalog actions and handler implementations do not match",
      { declared: declaredActions, implemented: implementedActions },
    );
  }
}

export function assertCatalogSpec(catalog: Catalog, spec: NextAppSpec): void {
  const data = catalogData(catalog);
  const componentSchemas = new Map(
    Object.entries(data.components).map(([name, definition]) => [
      name,
      definition.props ? expressionAwareCatalogSchema(definition.props) : undefined,
    ]),
  );
  const actionSchemas = new Map(
    Object.entries(data.actions).map(([name, definition]) => [
      name,
      definition.params ? expressionAwareCatalogSchema(definition.params) : undefined,
    ]),
  );
  for (const tree of trees(spec)) {
    for (const element of Object.values(tree.elements)) {
      const propsSchema = element.type === "Slot"
        ? z.object({}).strict()
        : element.type === "Link"
          ? expressionAwareLinkPropsSchema
          : componentSchemas.get(element.type);
      if (
        element.type !== "Slot" &&
        element.type !== "Link" &&
        !componentSchemas.has(element.type)
      ) {
        throw new RuntimeError("catalog_invalid", "Element type is not in the host catalog", {
          component: element.type,
        });
      }
      if (propsSchema && !propsSchema.safeParse(element.props).success) {
        throw new RuntimeError("catalog_invalid", "Element props do not match the host catalog", {
          component: element.type,
        });
      }
      for (const bindings of [element.on, element.watch]) {
        for (const value of Object.values(bindings ?? {})) {
          for (const binding of Array.isArray(value) ? value : [value]) {
            if (!RESERVED_ACTIONS.has(binding.action) && !actionSchemas.has(binding.action)) {
              throw new RuntimeError("catalog_invalid", "Action is not in the host catalog", {
                action: binding.action,
              });
            }
            const paramsSchema = actionSchemas.get(binding.action);
            if (paramsSchema && !paramsSchema.safeParse(binding.params ?? {}).success) {
              throw new RuntimeError("catalog_invalid", "Action params do not match the host catalog", {
                action: binding.action,
              });
            }
            for (const followUp of [binding.onSuccess, binding.onError]) {
              if (
                followUp &&
                "action" in followUp &&
                !RESERVED_ACTIONS.has(followUp.action) &&
                !actionSchemas.has(followUp.action)
              ) {
                throw new RuntimeError("catalog_invalid", "Chained action is not in the host catalog", {
                  action: followUp.action,
                });
              }
            }
          }
        }
      }
    }
  }
}
