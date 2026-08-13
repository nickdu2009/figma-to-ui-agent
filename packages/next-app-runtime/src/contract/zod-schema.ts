import { z, type core, type ZodType } from "zod";
import type { UIElement, VisibilityCondition } from "@json-render/core";

import type { NextAppSpec, NextMetadata, NextRouteSpec } from "./types.js";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const dynamicNumberSchema = z.union([
  z.number(),
  z.object({ $state: z.string() }).strict(),
]);

const comparisonShape = {
  eq: jsonValueSchema.optional(),
  neq: jsonValueSchema.optional(),
  gt: dynamicNumberSchema.optional(),
  gte: dynamicNumberSchema.optional(),
  lt: dynamicNumberSchema.optional(),
  lte: dynamicNumberSchema.optional(),
  not: z.literal(true).optional(),
};

const singleConditionSchema = z.union([
  z.object({ $state: z.string(), ...comparisonShape }).strict(),
  z.object({ $item: z.string(), ...comparisonShape }).strict(),
  z.object({ $index: z.literal(true), ...comparisonShape }).strict(),
]);

const visibilityConditionSchema: z.ZodType<VisibilityCondition> = z.lazy(() =>
  z.union([
    z.boolean(),
    singleConditionSchema,
    z.array(singleConditionSchema),
    z.object({ $and: z.array(visibilityConditionSchema) }).strict(),
    z.object({ $or: z.array(visibilityConditionSchema) }).strict(),
  ]),
);

const dynamicExpressionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ $state: z.string() }).strict(),
    z.object({ $item: z.string() }).strict(),
    z.object({ $index: z.literal(true) }).strict(),
    z.object({ $bindState: z.string() }).strict(),
    z.object({ $bindItem: z.string() }).strict(),
    z
      .object({
        $cond: visibilityConditionSchema,
        $then: jsonValueSchema,
        $else: jsonValueSchema,
      })
      .strict(),
    z
      .object({
        $computed: z.string(),
        args: z.record(z.string(), jsonValueSchema).optional(),
      })
      .strict(),
    z.object({ $template: z.string() }).strict(),
  ]),
);

interface ZodInternals {
  type?: string;
  checks?: unknown[];
  shape?: Record<string, ZodType>;
  catchall?: ZodType;
  element?: ZodType;
  keyType?: ZodType;
  valueType?: ZodType;
  options?: ZodType[];
  discriminator?: string;
  inclusive?: boolean;
  items?: ZodType[];
  rest?: ZodType | null;
  innerType?: ZodType;
  left?: ZodType;
  right?: ZodType;
  in?: ZodType;
  out?: ZodType;
  transform?: (value: unknown, payload: unknown) => unknown;
  getter?: () => ZodType;
  [key: string]: unknown;
}

interface ZodCheckInternals {
  _zod?: { def?: { abort?: boolean; check?: string } };
  _def?: { abort?: boolean; check?: string };
}

function zodInternals(schema: ZodType): ZodInternals {
  return (schema as ZodType & { _def: ZodInternals })._def;
}

function cloneZod(schema: ZodType, definition: ZodInternals): ZodType {
  return (schema as ZodType & {
    clone: (definition: ZodInternals) => ZodType;
  }).clone(definition);
}

function containsDynamicExpression(value: unknown): boolean {
  const pending = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (dynamicExpressionSchema.safeParse(current).success) return true;
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    pending.push(...(Array.isArray(current) ? current : Object.values(current)));
  }
  return false;
}

function withoutDeferredChecks(definition: ZodInternals): ZodInternals {
  if (!Array.isArray(definition.checks)) return definition;
  return {
    ...definition,
    checks: definition.checks.filter((check) => {
      const internals = check as ZodCheckInternals;
      const kind = internals._zod?.def?.check ?? internals._def?.check;
      return kind !== "custom" && kind !== "overwrite";
    }),
  };
}

const deferredExpressionAccess = Symbol("deferred Catalog expression access");

function isProxyIncompatibleError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "DataCloneError";
}

interface ExpressionAccessState {
  deferred: boolean;
  targets: WeakMap<object, object>;
}

function trackExpressionReference(
  value: object,
  state: ExpressionAccessState,
  cache: WeakMap<object, object>,
): object {
  const cached = cache.get(value);
  if (cached) return cached;

  const defer = (): never => {
    state.deferred = true;
    throw deferredExpressionAccess;
  };
  const tracked = new Proxy(value, {
    get: defer,
    getOwnPropertyDescriptor: defer,
    getPrototypeOf: defer,
    has: defer,
    ownKeys: defer,
  });
  cache.set(value, tracked);
  state.targets.set(tracked, value);
  return tracked;
}

function trackExpressionAccess(
  value: unknown,
  state: ExpressionAccessState,
  cache = new WeakMap<object, object>(),
): unknown {
  if (dynamicExpressionSchema.safeParse(value).success) {
    state.deferred = true;
    throw deferredExpressionAccess;
  }
  if (typeof value !== "object" || value === null) return value;

  const cached = cache.get(value);
  if (cached) return cached;

  const tracked = new Proxy(value, {
    get(target, property, receiver) {
      return trackExpressionAccess(
        Reflect.get(target, property, receiver),
        state,
        cache,
      );
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (!descriptor || !("value" in descriptor)) return descriptor;
      return {
        ...descriptor,
        value: dynamicExpressionSchema.safeParse(descriptor.value).success
          ? trackExpressionReference(descriptor.value as object, state, cache)
          : trackExpressionAccess(descriptor.value, state, cache),
      };
    },
  });
  cache.set(value, tracked);
  state.targets.set(tracked, value);
  return tracked;
}

function withStaticDeferredChecks(
  candidate: ZodType,
  definition: ZodInternals,
): ZodType {
  if (!Array.isArray(definition.checks)) return candidate;
  const checks = definition.checks
    .flatMap((check) => {
      const internals = check as ZodCheckInternals;
      const checkDefinition = internals._zod?.def ?? internals._def;
      const kind = checkDefinition?.check;
      return kind === "custom" || kind === "overwrite"
        ? [{
            abort: checkDefinition?.abort === true,
            kind,
            schema: z.any().check(check as core.$ZodCheck<unknown>),
          }]
        : [];
    });
  if (checks.length === 0) return candidate;

  return candidate.superRefine((value, context) => {
    for (const check of checks) {
      const hasDynamicExpression = containsDynamicExpression(value);
      const access: ExpressionAccessState = {
        deferred: false,
        targets: new WeakMap(),
      };
      try {
        const result = check.schema.safeParse(
          trackExpressionAccess(value, access),
        );
        if (access.deferred) {
          // Later checks may depend on an unknown overwrite output, while an
          // aborting custom check may suppress them in the host schema.
          if (check.kind === "overwrite" || check.abort) break;
          continue;
        }
        if (!result.success) {
          for (const issue of result.error.issues) {
            context.addIssue(issue as core.$ZodSuperRefineIssue);
          }
          if (check.abort) break;
        } else if (check.kind === "overwrite") {
          value = typeof result.data === "object" && result.data !== null
            ? access.targets.get(result.data) ?? result.data
            : result.data;
        }
      } catch (error) {
        if (
          error === deferredExpressionAccess ||
          access.deferred ||
          hasDynamicExpression
        ) {
          // A host refinement may catch the sentinel itself; the access flag
          // still keeps its unresolved result from becoming a literal verdict.
          // Proxy-incompatible opaque operations cannot produce a static
          // verdict while any unresolved expression remains in the value.
          if (check.kind === "overwrite" || check.abort) break;
          continue;
        }
        throw error;
      }
    }
  });
}

/**
 * Catalog schemas describe values after json-render resolves expressions, while
 * NextAppSpec stores those expressions before resolution. Preserve the host
 * schema for literals and add the public 0.19.0 expression forms at each value
 * position instead of treating the expression object as the literal itself.
 */
export function expressionAwareCatalogSchema(schema: ZodType): ZodType {
  const directCache = new Map<ZodType, ZodType>();
  const rootCache = new Map<ZodType, ZodType>();

  const visit = (current: ZodType, allowDirectExpression: boolean): ZodType => {
    const cache = allowDirectExpression ? directCache : rootCache;
    const cached = cache.get(current);
    if (cached) return cached;

    const definition = zodInternals(current);
    const wrapDirect = (candidate: ZodType): ZodType => {
      const deferredCandidate = candidate.refine(containsDynamicExpression, {
        message: "Catalog expression validation requires a dynamic expression",
      });
      return allowDirectExpression && definition.type !== "never"
        ? z.union([dynamicExpressionSchema, deferredCandidate, current])
        : z.union([deferredCandidate, current]);
    };
    let result: ZodType;

    switch (definition.type) {
      case "object": {
        const shape = definition.shape ?? {};
        const relaxedShape = Object.fromEntries(
          Object.entries(shape).map(([name, value]) => [name, visit(value, true)]),
        );
        result = wrapDirect(withStaticDeferredChecks(
          cloneZod(current, {
            ...withoutDeferredChecks(definition),
            shape: relaxedShape,
            catchall: definition.catchall
              ? visit(definition.catchall, true)
              : definition.catchall,
          }),
          definition,
        ));
        break;
      }
      case "array":
        result = wrapDirect(withStaticDeferredChecks(
          cloneZod(current, {
            ...withoutDeferredChecks(definition),
            element: visit(definition.element!, true),
          }),
          definition,
        ));
        break;
      case "record":
        result = wrapDirect(withStaticDeferredChecks(
          cloneZod(current, {
            ...withoutDeferredChecks(definition),
            valueType: visit(definition.valueType!, true),
          }),
          definition,
        ));
        break;
      case "tuple":
        result = wrapDirect(withStaticDeferredChecks(
          cloneZod(current, {
            ...withoutDeferredChecks(definition),
            items: (definition.items ?? []).map((item) => visit(item, true)),
            rest: definition.rest ? visit(definition.rest, true) : definition.rest,
          }),
          definition,
        ));
        break;
      case "union":
        result = wrapDirect(withStaticDeferredChecks(
          definition.inclusive === false && definition.discriminator === undefined
            ? cloneZod(current, {
                ...withoutDeferredChecks(definition),
                options: (definition.options ?? []).map((option) => visit(option, true)),
              })
            : z.union(
                (definition.options ?? []).map((option) => visit(option, true)) as [
                  ZodType,
                  ZodType,
                  ...ZodType[],
                ],
              ),
          definition,
        ));
        break;
      case "intersection":
        result = wrapDirect(withStaticDeferredChecks(
          cloneZod(current, {
            ...withoutDeferredChecks(definition),
            left: visit(definition.left!, true),
            right: visit(definition.right!, true),
          }),
          definition,
        ));
        break;
      case "optional":
      case "nullable":
      case "default":
      case "prefault":
      case "catch":
      case "readonly":
      case "nonoptional":
        result = cloneZod(current, {
          ...definition,
          innerType: visit(definition.innerType!, allowDirectExpression),
        });
        break;
      case "lazy":
        result = wrapDirect(z.lazy(() => visit(definition.getter!(), true)));
        break;
      case "pipe": {
        type PipelineEvaluation =
          | { status: "deferred" }
          | { status: "failed"; issues: readonly unknown[] }
          | { status: "passed"; data: unknown };
        const evaluatePipeline = (
          pipeline: ZodType,
          input: unknown,
          allowExpression: boolean,
        ): PipelineEvaluation => {
          const pipelineDefinition = zodInternals(pipeline);
          if (pipelineDefinition.type === "pipe") {
            const first = evaluatePipeline(
              pipelineDefinition.in!,
              input,
              allowExpression,
            );
            if (first.status !== "passed") return first;
            const transformed = pipelineDefinition.transform
              ? evaluatePipeline(
                  z.transform(pipelineDefinition.transform),
                  first.data,
                  true,
                )
              : first;
            if (transformed.status !== "passed") return transformed;
            return evaluatePipeline(pipelineDefinition.out!, transformed.data, true);
          }
          if (pipelineDefinition.type === "transform") {
            const access: ExpressionAccessState = {
              deferred: false,
              targets: new WeakMap(),
            };
            try {
              const parsed = pipeline.safeParse(trackExpressionAccess(input, access));
              if (access.deferred) return { status: "deferred" };
              return parsed.success
                ? {
                    status: "passed",
                    data: typeof parsed.data === "object" && parsed.data !== null
                      ? access.targets.get(parsed.data) ?? parsed.data
                      : parsed.data,
                  }
                : { status: "failed", issues: parsed.error.issues };
            } catch (error) {
              if (
                error === deferredExpressionAccess ||
                access.deferred ||
                (
                  isProxyIncompatibleError(error) &&
                  containsDynamicExpression(input)
                )
              ) {
                return { status: "deferred" };
              }
              throw error;
            }
          }
          try {
            const parsed = visit(pipeline, allowExpression).safeParse(input);
            return parsed.success
              ? { status: "passed", data: parsed.data }
              : { status: "failed", issues: parsed.error.issues };
          } catch (error) {
            if (error === deferredExpressionAccess) return { status: "deferred" };
            throw error;
          }
        };
        const candidate = z.any().superRefine((value, context) => {
          const evaluation = evaluatePipeline(current, value, allowDirectExpression);
          if (evaluation.status !== "failed") return;
          for (const issue of evaluation.issues) {
            context.addIssue(issue as core.$ZodSuperRefineIssue);
          }
        });
        result = wrapDirect(candidate);
        break;
      }
      case "any":
      case "unknown":
        result = current;
        break;
      default:
        result = allowDirectExpression && definition.type !== "never"
          ? z.union([current, dynamicExpressionSchema])
          : current;
        break;
    }

    cache.set(current, result);
    return result;
  };

  return visit(schema, false);
}

const actionConfirmSchema = z
  .object({
    title: z.string(),
    message: z.string(),
    confirmLabel: z.string().optional(),
    cancelLabel: z.string().optional(),
    variant: z.enum(["default", "danger"]).optional(),
  })
  .strict();

const actionOnSuccessSchema = z.union([
  z.object({ navigate: z.string() }).strict(),
  z.object({ set: z.record(z.string(), jsonValueSchema) }).strict(),
  z.object({ action: z.string() }).strict(),
]);

const actionOnErrorSchema = z.union([
  z.object({ set: z.record(z.string(), jsonValueSchema) }).strict(),
  z.object({ action: z.string() }).strict(),
]);

function catalogActionOnSuccessSchema(actionName: ZodType) {
  return z.union([
    z.object({ navigate: z.string() }).strict(),
    z.object({ set: z.record(z.string(), jsonValueSchema) }).strict(),
    z.object({ action: actionName }).strict(),
  ]);
}

function catalogActionOnErrorSchema(actionName: ZodType) {
  return z.union([
    z.object({ set: z.record(z.string(), jsonValueSchema) }).strict(),
    z.object({ action: actionName }).strict(),
  ]);
}

const actionBindingSchema = z
  .object({
    action: z.string(),
    params: z.record(z.string(), jsonValueSchema).optional(),
    preventDefault: z.boolean().optional(),
    confirm: actionConfirmSchema.optional(),
    onSuccess: actionOnSuccessSchema.optional(),
    onError: actionOnErrorSchema.optional(),
  })
  .strict();

const uiElementSchema: z.ZodType<UIElement> = z
  .object({
    type: z.string(),
    props: z.record(z.string(), jsonValueSchema),
    children: z.array(z.string()).optional(),
    visible: visibilityConditionSchema.optional(),
    on: z
      .record(
        z.string(),
        z.union([actionBindingSchema, z.array(actionBindingSchema)]),
      )
      .optional(),
    repeat: z
      .object({ statePath: z.string(), key: z.string().optional() })
      .strict()
      .optional(),
    watch: z
      .record(
        z.string(),
        z.union([actionBindingSchema, z.array(actionBindingSchema)]),
      )
      .optional(),
  })
  .strict();

interface CatalogSchemaEntry {
  props?: ZodType;
  params?: ZodType;
}

const dynamicParamsSchema = z.record(z.string(), jsonValueSchema);
const jsonPropsSchema = z.record(z.string(), jsonValueSchema);

function catalogActionBindingSchema(
  name: string,
  paramsSchema?: ZodType,
  chainedActionName: ZodType = z.string(),
) {
  const params = paramsSchema
    ? expressionAwareCatalogSchema(paramsSchema)
    : dynamicParamsSchema;
  const paramsField = paramsSchema && !paramsSchema.safeParse({}).success
    ? params
    : params.optional();
  return z
    .object({
      action: z.literal(name),
      params: paramsField,
      preventDefault: z.boolean().optional(),
      confirm: actionConfirmSchema.optional(),
      onSuccess: catalogActionOnSuccessSchema(chainedActionName).optional(),
      onError: catalogActionOnErrorSchema(chainedActionName).optional(),
    })
    .strict();
}

function createCatalogElementTreeSchema(
  components: Record<string, CatalogSchemaEntry>,
  actions: Record<string, CatalogSchemaEntry>,
) {
  const allowedActionNames = [
    "navigate",
    "setState",
    "pushState",
    "removeState",
    ...Object.keys(actions).filter(
      (name) => !["navigate", "setState", "pushState", "removeState"].includes(name),
    ),
  ] as [string, ...string[]];
  const chainedActionName = z.enum(allowedActionNames);
  const actionVariants = [
    catalogActionBindingSchema("navigate", undefined, chainedActionName),
    catalogActionBindingSchema("setState", undefined, chainedActionName),
    catalogActionBindingSchema("pushState", undefined, chainedActionName),
    catalogActionBindingSchema("removeState", undefined, chainedActionName),
    ...Object.entries(actions)
      .filter(([name]) => !["navigate", "setState", "pushState", "removeState"].includes(name))
      .map(([name, definition]) => catalogActionBindingSchema(
        name,
        definition.params,
        chainedActionName,
      )),
  ] as [ZodType, ZodType, ...ZodType[]];
  const binding = z.union(actionVariants);
  const bindings = z.record(z.string(), z.union([binding, z.array(binding)]));
  const commonShape = {
    children: z.array(z.string()).optional(),
    visible: visibilityConditionSchema.optional(),
    on: bindings.optional(),
    repeat: z
      .object({ statePath: z.string(), key: z.string().optional() })
      .strict()
      .optional(),
    watch: bindings.optional(),
  };
  const componentVariants = [
    z.object({ type: z.literal("Slot"), props: z.object({}).strict(), ...commonShape }).strict(),
    z.object({
      type: z.literal("Link"),
      props: expressionAwareCatalogSchema(z.object({
        href: z.string(),
        replace: z.boolean().optional(),
        prefetch: z.boolean().optional(),
        className: z.string().optional(),
        style: z.record(z.string(), z.unknown()).optional(),
      }).strict()),
      ...commonShape,
    }).strict(),
    ...Object.entries(components)
      .filter(([name]) => name !== "Slot" && name !== "Link")
      .map(([name, definition]) => z.object({
        type: z.literal(name),
        props: definition.props
          ? expressionAwareCatalogSchema(definition.props)
          : jsonPropsSchema,
        ...commonShape,
      }).strict()),
  ] as [ZodType, ZodType, ...ZodType[]];
  const element = z.union(componentVariants);
  return z.object({
    root: z.string(),
    elements: z.record(z.string(), element),
    state: z.record(z.string(), jsonValueSchema).optional(),
  }).strict();
}

export function createCatalogAwareNextAppSpecSchema(
  components: Record<string, CatalogSchemaEntry>,
  actions: Record<string, CatalogSchemaEntry>,
): z.ZodType<NextAppSpec> {
  const tree = createCatalogElementTreeSchema(components, actions);
  const route = z.object({
    page: tree,
    metadata: nextMetadataSchema.optional(),
    layout: z.string().optional(),
    loading: tree.optional(),
    error: tree.optional(),
    notFound: tree.optional(),
    loader: z.string().optional(),
    staticParams: z.array(z.record(z.string(), z.string())).optional(),
  }).strict();
  return z.object({
    metadata: nextMetadataSchema.optional(),
    routes: z.record(z.string(), route),
    layouts: z.record(z.string(), tree).optional(),
    state: z.record(z.string(), jsonValueSchema).optional(),
  }).strict() as z.ZodType<NextAppSpec>;
}

export const elementTreeSchema = z
  .object({
    root: z.string(),
    elements: z.record(z.string(), uiElementSchema),
    state: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

export const nextMetadataSchema: z.ZodType<NextMetadata> = z
  .object({
    title: z
      .union([
        z.string(),
        z
          .object({
            default: z.string(),
            template: z.string().optional(),
            absolute: z.string().optional(),
          })
          .strict(),
      ])
      .optional(),
    description: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    openGraph: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        images: z.union([z.string(), z.array(z.string())]).optional(),
        type: z.string().optional(),
        url: z.string().optional(),
        siteName: z.string().optional(),
        locale: z.string().optional(),
      })
      .strict()
      .optional(),
    twitter: z
      .object({
        card: z
          .enum(["summary", "summary_large_image", "app", "player"])
          .optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        images: z.union([z.string(), z.array(z.string())]).optional(),
        creator: z.string().optional(),
        site: z.string().optional(),
      })
      .strict()
      .optional(),
    robots: z
      .union([
        z.string(),
        z.object({ index: z.boolean().optional(), follow: z.boolean().optional() }).strict(),
      ])
      .optional(),
    alternates: z.object({ canonical: z.string().optional() }).strict().optional(),
    icons: z
      .union([
        z.string(),
        z
          .object({
            icon: z.string().optional(),
            apple: z.string().optional(),
            shortcut: z.string().optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

export const nextRouteSpecSchema: z.ZodType<NextRouteSpec> = z
  .object({
    page: elementTreeSchema,
    metadata: nextMetadataSchema.optional(),
    layout: z.string().optional(),
    loading: elementTreeSchema.optional(),
    error: elementTreeSchema.optional(),
    notFound: elementTreeSchema.optional(),
    loader: z.string().optional(),
    staticParams: z.array(z.record(z.string(), z.string())).optional(),
  })
  .strict();

export const nextAppSpecSchema: z.ZodType<NextAppSpec> = z
  .object({
    metadata: nextMetadataSchema.optional(),
    routes: z.record(z.string(), nextRouteSpecSchema),
    layouts: z.record(z.string(), elementTreeSchema).optional(),
    state: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

export function parseNextAppSpec(input: unknown): NextAppSpec {
  return nextAppSpecSchema.parse(input);
}
