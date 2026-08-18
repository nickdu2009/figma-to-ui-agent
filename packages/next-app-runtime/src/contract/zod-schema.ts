import { z, type core, type ZodType } from "zod";
import type { UIElement, VisibilityCondition } from "@json-render/core";

import {
  isPlainJsonArray,
  isPlainJsonObject,
} from "./json-value.js";
import type { NextAppSpec, NextMetadata, NextRouteSpec } from "./types.js";

const RECORD_KEY_ESCAPE = "\u0000next-app-runtime-record-key:";

function encodeRecordKey(key: string): string {
  if (key === "__proto__") return `${RECORD_KEY_ESCAPE}proto`;
  return key.startsWith(RECORD_KEY_ESCAPE)
    ? `${RECORD_KEY_ESCAPE}literal:${key}`
    : key;
}

export function decodeRecordKey(key: string): string {
  if (key === `${RECORD_KEY_ESCAPE}proto`) return "__proto__";
  const literalPrefix = `${RECORD_KEY_ESCAPE}literal:`;
  return key.startsWith(literalPrefix) ? key.slice(literalPrefix.length) : key;
}

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

interface ZodRunPayload {
  value: unknown;
  issues: unknown[];
  [key: string]: unknown;
}

interface ZodRuntimeInternals {
  run: (
    payload: ZodRunPayload,
    context: unknown,
  ) => ZodRunPayload | Promise<ZodRunPayload>;
  values?: Set<PropertyKey>;
}

function zodInternals(schema: ZodType): ZodInternals {
  return (schema as ZodType & { _def: ZodInternals })._def;
}

function cloneZod(schema: ZodType, definition: ZodInternals): ZodType {
  return (schema as ZodType & {
    clone: (definition: ZodInternals) => ZodType;
  }).clone(definition);
}

function zodRuntimeInternals(schema: ZodType): ZodRuntimeInternals {
  return (schema as ZodType & { _zod: ZodRuntimeInternals })._zod;
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
          (isProxyIncompatibleError(error) && hasDynamicExpression)
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

function encodedRecordKeySchema(keySchema: ZodType): ZodType {
  const candidate = cloneZod(keySchema, zodInternals(keySchema));
  const originalRuntime = zodRuntimeInternals(keySchema);
  const candidateRuntime = zodRuntimeInternals(candidate);
  const mapResult = (result: ZodRunPayload): ZodRunPayload => {
    if (result.issues.length === 0 && typeof result.value === "string") {
      result.value = encodeRecordKey(result.value);
    }
    return result;
  };
  candidateRuntime.run = (payload, context) => {
    const result = originalRuntime.run({
      ...payload,
      issues: [...payload.issues],
      value: typeof payload.value === "string"
        ? decodeRecordKey(payload.value)
        : payload.value,
    }, context);
    return result instanceof Promise ? result.then(mapResult) : mapResult(result);
  };
  Object.defineProperty(candidateRuntime, "values", {
    configurable: true,
    enumerable: true,
    value: originalRuntime.values === undefined
      ? undefined
      : new Set(
          [...originalRuntime.values].map((value) =>
            typeof value === "string" ? encodeRecordKey(value) : value
          ),
        ),
    writable: false,
  });
  return candidate;
}

function ownRecordSchema<T>(
  keySchema: z.ZodString,
  valueSchema: z.ZodType<T>,
): z.ZodType<Record<string, T>> {
  const candidateKeySchema = encodedRecordKeySchema(keySchema);
  return withDirectRecordKeyMapping(
    z.record(candidateKeySchema as z.ZodType<PropertyKey>, valueSchema),
  ) as z.ZodType<Record<string, T>>;
}

interface DirectRecordKeyMapping {
  value: unknown;
  provenance: Map<string, string>;
}

function mapDirectRecordKeys(
  value: unknown,
  mapKey: (key: string) => string,
  knownKeys: readonly string[] = [],
): DirectRecordKeyMapping {
  const provenance = new Map<string, string>();
  for (const key of knownKeys) provenance.set(mapKey(key), key);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { value, provenance };
  }
  const mapped: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    if (typeof key === "string") {
      const mappedKey = mapKey(key);
      provenance.set(mappedKey, key);
      Object.defineProperty(mapped, mappedKey, descriptor);
    } else {
      Object.defineProperty(mapped, key, descriptor);
    }
  }
  return { value: mapped, provenance };
}

function remapDirectRecordIssueInput(
  input: unknown,
  provenance: ReadonlyMap<string, string>,
): { changed: boolean; value: unknown } {
  if (typeof input === "string") {
    const mapped = provenance.get(input) ?? input;
    return { changed: mapped !== input, value: mapped };
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { changed: false, value: input };
  }

  let changed = false;
  const mapped: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor) continue;
    const mappedKey = typeof key === "string"
      ? provenance.get(key) ?? key
      : key;
    if (mappedKey !== key) changed = true;
    Object.defineProperty(mapped, mappedKey, descriptor);
  }
  return { changed, value: changed ? mapped : input };
}

function remapUnrecognizedKeysMessage(
  message: string,
  keyProvenance: ReadonlyMap<string, string>,
): string {
  const replacements = [...keyProvenance]
    .flatMap(([encoded, publicKey]) => [
      { encoded, publicKey },
      {
        encoded: JSON.stringify(encoded).slice(1, -1),
        publicKey: JSON.stringify(publicKey).slice(1, -1),
      },
    ])
    .filter(({ encoded, publicKey }) => encoded !== publicKey)
    .sort((left, right) => right.encoded.length - left.encoded.length);
  if (replacements.length === 0) return message;

  let remapped = "";
  for (let index = 0; index < message.length;) {
    const replacement = replacements.find(({ encoded }) =>
      message.startsWith(encoded, index)
    );
    if (!replacement) {
      remapped += message[index];
      index += 1;
      continue;
    }
    remapped += replacement.publicKey;
    index += replacement.encoded.length;
  }
  return remapped;
}

interface RemappedDirectRecordIssue {
  changed: boolean;
  issue: Record<string, unknown>;
}

function remapDirectRecordIssue(
  issue: Record<string, unknown>,
  provenance: ReadonlyMap<string, string>,
): RemappedDirectRecordIssue {
  const mapped = { ...issue };
  const messageKeyProvenance = new Map<string, string>();
  let changed = false;
  if (Array.isArray(issue.path) && typeof issue.path[0] === "string") {
    const first = provenance.get(issue.path[0]);
    if (first !== undefined && first !== issue.path[0]) {
      mapped.path = [first, ...issue.path.slice(1)];
      changed = true;
    }
  }
  if (Array.isArray(issue.keys)) {
    const originalKeys = issue.keys;
    const keys = originalKeys.map((key) => {
      if (typeof key !== "string") return key;
      const publicKey = provenance.get(key) ?? key;
      if (publicKey !== key) messageKeyProvenance.set(key, publicKey);
      return publicKey;
    });
    mapped.keys = keys;
    if (keys.some((key, index) => key !== originalKeys[index])) changed = true;
  }
  if (Array.isArray(issue.errors)) {
    mapped.errors = issue.errors.map((branch) => {
      if (!Array.isArray(branch)) return branch;
      return branch.map((nested) => {
        const result = remapDirectRecordIssue(
          nested as Record<string, unknown>,
          provenance,
        );
        if (result.changed) changed = true;
        return result.issue;
      });
    });
  }
  if (Object.hasOwn(issue, "input")) {
    const input = remapDirectRecordIssueInput(issue.input, provenance);
    mapped.input = input.value;
    if (input.changed) changed = true;
  }
  if (
    issue.code === "unrecognized_keys" &&
    typeof issue.message === "string" &&
    messageKeyProvenance.size > 0
  ) {
    mapped.message = remapUnrecognizedKeysMessage(
      issue.message,
      messageKeyProvenance,
    );
  }
  return { changed, issue: mapped };
}

function withDirectRecordKeyMapping(
  candidate: ZodType,
  knownKeys: readonly string[] = [],
): ZodType {
  const bridge = cloneZod(candidate, zodInternals(candidate));
  const originalRuntime = zodRuntimeInternals(candidate);
  const bridgeRuntime = zodRuntimeInternals(bridge);
  const finish = (
    result: ZodRunPayload,
    provenance: ReadonlyMap<string, string>,
  ): ZodRunPayload => {
    if (result.issues.length > 0) {
      result.issues = result.issues.map((issue) =>
        remapDirectRecordIssue(
          issue as Record<string, unknown>,
          provenance,
        ).issue
      );
    } else {
      result.value = mapDirectRecordKeys(result.value, decodeRecordKey).value;
    }
    return result;
  };
  bridgeRuntime.run = (payload, context) => {
    const encoded = mapDirectRecordKeys(payload.value, encodeRecordKey, knownKeys);
    const result = originalRuntime.run({
      ...payload,
      issues: [...payload.issues],
      value: encoded.value,
    }, context);
    return result instanceof Promise
      ? result.then((parsed) => finish(parsed, encoded.provenance))
      : finish(result, encoded.provenance);
  };
  return bridge;
}

function containsOwnRecordKeyCandidate(
  schema: ZodType,
  seen = new Set<ZodType>(),
): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const definition = zodInternals(schema);
  switch (definition.type) {
    case "record":
      return true;
    case "object":
      return Object.values(definition.shape ?? {}).some((child) =>
        containsOwnRecordKeyCandidate(child, seen)
      ) || Boolean(
        definition.catchall && containsOwnRecordKeyCandidate(definition.catchall, seen),
      );
    case "array":
      return Boolean(
        definition.element && containsOwnRecordKeyCandidate(definition.element, seen),
      );
    case "tuple":
      return (definition.items ?? []).some((child) =>
        containsOwnRecordKeyCandidate(child, seen)
      ) || Boolean(definition.rest && containsOwnRecordKeyCandidate(definition.rest, seen));
    case "union":
      return (definition.options ?? []).some((child) =>
        containsOwnRecordKeyCandidate(child, seen)
      );
    case "intersection":
      return containsOwnRecordKeyCandidate(definition.left!, seen) ||
        containsOwnRecordKeyCandidate(definition.right!, seen);
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
      return containsOwnRecordKeyCandidate(definition.innerType!, seen);
    case "lazy":
      return containsOwnRecordKeyCandidate(definition.getter!(), seen);
    case "pipe":
      return containsOwnRecordKeyCandidate(definition.in!, seen) ||
        containsOwnRecordKeyCandidate(definition.out!, seen);
    default:
      return false;
  }
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
      const deferredCandidate = z
        .any()
        .refine(containsDynamicExpression, {
          message: "Catalog expression validation requires a dynamic expression",
        })
        .pipe(candidate);
      return allowDirectExpression && definition.type !== "never"
        ? z.union([dynamicExpressionSchema, deferredCandidate, current])
        : z.union([deferredCandidate, current]);
    };
    const wrapCandidate = (candidate: ZodType): ZodType => {
      if (!containsOwnRecordKeyCandidate(current)) return wrapDirect(candidate);
      return allowDirectExpression
        ? z.union([dynamicExpressionSchema, candidate])
        : candidate;
    };
    let result: ZodType;

    switch (definition.type) {
      case "object": {
        const shape = definition.shape ?? {};
        const relaxedShape = Object.fromEntries(
          Object.entries(shape).map(([name, value]) => [
            encodeRecordKey(name),
            visit(value, true),
          ]),
        );
        const candidate = withStaticDeferredChecks(
          cloneZod(current, {
            ...withoutDeferredChecks(definition),
            shape: relaxedShape,
            catchall: definition.catchall
              ? visit(definition.catchall, true)
              : definition.catchall,
          }),
          definition,
        );
        const hasMappedShapeKey = Object.keys(shape).some(
          (key) => encodeRecordKey(key) !== key,
        );
        result = withDirectRecordKeyMapping(
          hasMappedShapeKey
            ? allowDirectExpression
              ? z.union([dynamicExpressionSchema, candidate])
              : candidate
            : wrapCandidate(candidate),
          Object.keys(shape),
        );
        break;
      }
      case "array":
        result = wrapCandidate(withStaticDeferredChecks(
          cloneZod(current, {
            ...withoutDeferredChecks(definition),
            element: visit(definition.element!, true),
          }),
          definition,
        ));
        break;
      case "record":
        {
          const keyType = definition.keyType!;
          const valueType = visit(definition.valueType!, true);
          const candidateKeyType = encodedRecordKeySchema(keyType);
          const candidate = withStaticDeferredChecks(cloneZod(current, {
            ...withoutDeferredChecks(definition),
            keyType: candidateKeyType,
            valueType,
          }), definition);
          result = withDirectRecordKeyMapping(
            allowDirectExpression
              ? z.union([dynamicExpressionSchema, candidate])
              : candidate,
            [...(zodRuntimeInternals(keyType).values ?? [])]
              .filter((value): value is string | number =>
                typeof value === "string" || typeof value === "number"
              )
              .map(String),
          );
        }
        break;
      case "tuple":
        result = wrapCandidate(withStaticDeferredChecks(
          cloneZod(current, {
            ...withoutDeferredChecks(definition),
            items: (definition.items ?? []).map((item) => visit(item, true)),
            rest: definition.rest ? visit(definition.rest, true) : definition.rest,
          }),
          definition,
        ));
        break;
      case "union":
        result = wrapCandidate(withStaticDeferredChecks(
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
        result = wrapCandidate(withStaticDeferredChecks(
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
        result = wrapCandidate(z.lazy(() => visit(definition.getter!(), true)));
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
        const candidate = z.any().transform((value, context) => {
          const evaluation = evaluatePipeline(current, value, allowDirectExpression);
          if (evaluation.status === "failed") {
            for (const issue of evaluation.issues) {
              context.addIssue(issue as core.$ZodSuperRefineIssue);
            }
            return value;
          }
          return evaluation.status === "passed" ? evaluation.data : value;
        });
        result = wrapCandidate(candidate);
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
  z.object({ set: ownRecordSchema(z.string(), jsonValueSchema) }).strict(),
  z.object({ action: z.string() }).strict(),
]);

const actionOnErrorSchema = z.union([
  z.object({ set: ownRecordSchema(z.string(), jsonValueSchema) }).strict(),
  z.object({ action: z.string() }).strict(),
]);

function catalogActionOnSuccessSchema(actionName: ZodType) {
  return z.union([
    z.object({ navigate: z.string() }).strict(),
    z.object({ set: ownRecordSchema(z.string(), jsonValueSchema) }).strict(),
    z.object({ action: actionName }).strict(),
  ]);
}

function catalogActionOnErrorSchema(actionName: ZodType) {
  return z.union([
    z.object({ set: ownRecordSchema(z.string(), jsonValueSchema) }).strict(),
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

const dynamicParamsSchema = ownRecordSchema(z.string(), jsonValueSchema);
const jsonPropsSchema = ownRecordSchema(z.string(), jsonValueSchema);
const actionBindingParamsSchemas = new WeakMap<ZodType, ZodType>();

export function actionBindingParamsSchema(schema: ZodType): ZodType | undefined {
  return actionBindingParamsSchemas.get(schema);
}

function catalogActionBindingSchema(
  name: string,
  paramsSchema?: ZodType,
  chainedActionName: ZodType = z.string(),
) {
  const params = paramsSchema
    ? expressionAwareCatalogSchema(paramsSchema)
    : dynamicParamsSchema;
  const binding = z
    .object({
      action: z.literal(name),
      params: params.optional(),
      preventDefault: z.boolean().optional(),
      confirm: actionConfirmSchema.optional(),
      onSuccess: catalogActionOnSuccessSchema(chainedActionName).optional(),
      onError: catalogActionOnErrorSchema(chainedActionName).optional(),
    })
    .strict()
    .superRefine((binding, context) => {
      if (Object.hasOwn(binding, "params")) return;
      const result = params.safeParse({});
      if (result.success) return;
      for (const issue of result.error.issues) {
        context.addIssue({
          ...issue,
          path: ["params", ...issue.path],
        } as core.$ZodSuperRefineIssue);
      }
    });
  actionBindingParamsSchemas.set(binding, params);
  return binding;
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
  const bindings = ownRecordSchema(
    z.string(),
    z.union([binding, z.array(binding)]),
  );
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
    elements: ownRecordSchema(z.string(), element),
    state: ownRecordSchema(z.string(), jsonValueSchema).optional(),
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
    staticParams: z.array(ownRecordSchema(z.string(), z.string())).optional(),
  }).strict();
  return z.object({
    metadata: nextMetadataSchema.optional(),
    routes: ownRecordSchema(z.string(), route),
    layouts: ownRecordSchema(z.string(), tree).optional(),
    state: ownRecordSchema(z.string(), jsonValueSchema).optional(),
  }).strict() as z.ZodType<NextAppSpec>;
}

const elementTreeStructureSchema = z
  .object({
    root: z.string(),
    elements: z.record(z.string(), uiElementSchema),
    state: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

const nextMetadataStructureSchema: z.ZodType<NextMetadata> = z
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

const nextRouteSpecStructureSchema: z.ZodType<NextRouteSpec> = z
  .object({
    page: elementTreeStructureSchema,
    metadata: nextMetadataStructureSchema.optional(),
    layout: z.string().optional(),
    loading: elementTreeStructureSchema.optional(),
    error: elementTreeStructureSchema.optional(),
    notFound: elementTreeStructureSchema.optional(),
    loader: z.string().optional(),
    staticParams: z.array(z.record(z.string(), z.string())).optional(),
  })
  .strict();

interface RecordKeyMapping {
  value: unknown;
  provenance: Map<string, string>;
}

const recordKeySnapshotFailure = Symbol("record key snapshot failure");

function snapshotRecordKeyInput(
  value: unknown,
  active = new WeakSet<object>(),
  snapshots = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) throw recordKeySnapshotFailure;
  if (snapshots.has(value)) return snapshots.get(value);

  let array: boolean;
  let plain: boolean;
  let keys: PropertyKey[];
  try {
    array = Array.isArray(value);
    plain = array
      ? isPlainJsonArray(value as unknown[])
      : isPlainJsonObject(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw recordKeySnapshotFailure;
  }
  if (!plain) throw recordKeySnapshotFailure;

  let arrayLength: number | undefined;
  const entries: Array<{ descriptor: PropertyDescriptor; key: string }> = [];
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw recordKeySnapshotFailure;
    }
    if (!descriptor || !("value" in descriptor)) {
      throw recordKeySnapshotFailure;
    }
    if (array && key === "length") {
      if (
        descriptor.enumerable ||
        !Number.isSafeInteger(descriptor.value) ||
        descriptor.value < 0 ||
        descriptor.value > 0xffff_ffff
      ) {
        throw recordKeySnapshotFailure;
      }
      arrayLength = descriptor.value as number;
      continue;
    }
    if (typeof key !== "string" || !descriptor.enumerable) {
      throw recordKeySnapshotFailure;
    }
    entries.push({ descriptor, key });
  }
  if (array && arrayLength === undefined) throw recordKeySnapshotFailure;

  const snapshot = (array
    ? new Array<unknown>(arrayLength!)
    : {}) as Record<PropertyKey, unknown>;
  snapshots.set(value, snapshot);
  active.add(value);
  try {
    for (const { descriptor, key } of entries) {
      Object.defineProperty(snapshot, key, {
        ...descriptor,
        value: snapshotRecordKeyInput(descriptor.value, active, snapshots),
      });
    }
  } finally {
    active.delete(value);
  }
  return snapshot;
}

function mapRecordKeys(
  value: unknown,
  mapKey: (key: string) => string,
  provenance = new Map<string, string>(),
): RecordKeyMapping {
  if (Array.isArray(value)) {
    if (!isPlainJsonArray(value)) return { value, provenance };
    const mapped = new Array<unknown>(value.length);
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      const mappedKey = mapKey(key);
      provenance.set(mappedKey, key);
      Object.defineProperty(mapped, mappedKey, "value" in descriptor
        ? {
            ...descriptor,
            value: mapRecordKeys(descriptor.value, mapKey, provenance).value,
          }
        : descriptor);
    }
    return { value: mapped, provenance };
  }
  if (value === null || typeof value !== "object") return { value, provenance };
  if (!isPlainJsonObject(value)) return { value, provenance };

  const mapped: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    const mappedKey = mapKey(key);
    provenance.set(mappedKey, key);
    Object.defineProperty(mapped, mappedKey, "value" in descriptor
      ? {
          ...descriptor,
          value: mapRecordKeys(descriptor.value, mapKey, provenance).value,
        }
      : descriptor);
  }
  return { value: mapped, provenance };
}

const nextAppSpecStructureSchema: z.ZodType<NextAppSpec> = z
  .object({
    metadata: nextMetadataStructureSchema.optional(),
    routes: z.record(z.string(), nextRouteSpecStructureSchema),
    layouts: z.record(z.string(), elementTreeStructureSchema).optional(),
    state: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

function remapRecordKeyIssueInput(
  input: unknown,
  provenance: ReadonlyMap<string, string>,
): unknown {
  if (typeof input === "string") return provenance.get(input) ?? input;
  return mapRecordKeys(input, decodeRecordKey).value;
}

function remapRecordKeyIssue(
  issue: Record<string, unknown>,
  provenance: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const mapped = { ...issue };
  const messageKeyProvenance = new Map<string, string>();
  if (Array.isArray(issue.path)) {
    mapped.path = issue.path.map((segment) =>
      typeof segment === "string" ? provenance.get(segment) ?? segment : segment
    );
  }
  if (Array.isArray(issue.keys)) {
    mapped.keys = issue.keys.map((key) => {
      if (typeof key !== "string") return key;
      const publicKey = provenance.get(key) ?? key;
      if (publicKey !== key) messageKeyProvenance.set(key, publicKey);
      return publicKey;
    });
  }
  if (Array.isArray(issue.errors)) {
    mapped.errors = issue.errors.map((branch) =>
      Array.isArray(branch)
        ? branch.map((nested) => remapRecordKeyIssue(
            nested as Record<string, unknown>,
            provenance,
          ))
        : branch
    );
  }
  if (Object.hasOwn(issue, "input")) {
    mapped.input = remapRecordKeyIssueInput(issue.input, provenance);
  }
  if (
    issue.code === "unrecognized_keys" &&
    typeof issue.message === "string" &&
    messageKeyProvenance.size > 0
  ) {
    mapped.message = remapUnrecognizedKeysMessage(
      issue.message,
      messageKeyProvenance,
    );
  }
  return mapped;
}

const recordKeySnapshotFailureSchema = z.never(
  "Input properties could not be inspected",
);

function recordKeySafeSchema<T>(structure: z.ZodType<T>): z.ZodType<T> {
  const bridge = cloneZod(structure, zodInternals(structure));
  const originalRuntime = zodRuntimeInternals(structure);
  const bridgeRuntime = zodRuntimeInternals(bridge);
  const failureRuntime = zodRuntimeInternals(recordKeySnapshotFailureSchema);
  const finish = (
    result: ZodRunPayload,
    provenance: ReadonlyMap<string, string>,
  ): ZodRunPayload => {
    if (result.issues.length > 0) {
      result.issues = result.issues.map((issue) =>
        remapRecordKeyIssue(issue as Record<string, unknown>, provenance)
      );
    } else {
      result.value = mapRecordKeys(result.value, decodeRecordKey).value;
    }
    return result;
  };

  bridgeRuntime.run = (payload, context) => {
    let encoded: RecordKeyMapping;
    try {
      encoded = mapRecordKeys(
        snapshotRecordKeyInput(payload.value),
        encodeRecordKey,
      );
    } catch {
      return failureRuntime.run({
        ...payload,
        issues: [...payload.issues],
        value: null,
      }, context);
    }
    const result = originalRuntime.run({
      ...payload,
      issues: [...payload.issues],
      value: encoded.value,
    }, context);
    return result instanceof Promise
      ? result.then((parsed) => finish(parsed, encoded.provenance))
      : finish(result, encoded.provenance);
  };
  return bridge as z.ZodType<T>;
}

export const elementTreeSchema = recordKeySafeSchema(elementTreeStructureSchema);
export const nextMetadataSchema = recordKeySafeSchema(nextMetadataStructureSchema);
export const nextRouteSpecSchema = recordKeySafeSchema(nextRouteSpecStructureSchema);
export const nextAppSpecSchema = recordKeySafeSchema(nextAppSpecStructureSchema);

export function parseNextAppSpec(input: unknown): NextAppSpec {
  return nextAppSpecSchema.parse(input);
}
