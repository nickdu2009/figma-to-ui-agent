import {
  defineSchema,
  type Catalog,
  type JsonSchemaOptions,
  type PromptContext,
  type SchemaBuilder,
} from "@json-render/core";
import { z, type ZodType } from "zod";

import {
  createCatalogAwareNextAppSpecSchema,
  decodeRecordKey,
  nextAppSpecSchema,
} from "./zod-schema.js";

function zodTypeName(definition: Record<string, unknown>): string {
  if (typeof definition.type === "string") return definition.type;
  if (typeof definition.typeName === "string") return definition.typeName;
  return "";
}

function normalizedZodType(definition: Record<string, unknown>): string {
  const name = zodTypeName(definition);
  return name.startsWith("Zod") ? name.slice(3).toLowerCase() : name.toLowerCase();
}

function constrainedJsonSchema(schema: ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(converted)) {
    if (key !== "$schema") {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
  }
  return result;
}

function officialJsonSchema(
  schema: ZodType,
  strict = false,
  ancestors = new Set<ZodType>(),
): object {
  if (ancestors.has(schema)) {
    return strict
      ? { type: "object", properties: {}, required: [], additionalProperties: false }
      : {};
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(schema);
  const definition = schema._def as unknown as Record<string, unknown>;
  switch (normalizedZodType(definition)) {
    case "string":
    case "number":
    case "boolean":
    case "literal":
    case "enum":
      return constrainedJsonSchema(schema);
    case "array": {
      const inner = (definition.element ?? definition.type) as ZodType | undefined;
      const constrained = constrainedJsonSchema(schema);
      return {
        ...constrained,
        type: "array",
        items: inner ? officialJsonSchema(inner, strict, nextAncestors) : {},
      };
    }
    case "object": {
      const rawShape = definition.shape;
      const shape = (typeof rawShape === "function" ? rawShape() : rawShape) as
        | Record<string, ZodType>
        | undefined;
      if (!shape) {
        return strict
          ? { type: "object", properties: {}, required: [], additionalProperties: false }
          : { type: "object" };
      }
      const properties = Object.create(null) as Record<string, object>;
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const publicKey = decodeRecordKey(key);
        const valueDefinition = value._def as unknown as Record<string, unknown>;
        const valueType = normalizedZodType(valueDefinition);
        const optional = valueType === "optional";
        let propertySchema: object;
        if (strict) {
          required.push(publicKey);
          const converted = officialJsonSchema(value, true, nextAncestors);
          propertySchema = optional
            ? { anyOf: [converted, { type: "null" }] }
            : converted;
        } else {
          propertySchema = officialJsonSchema(value, false, nextAncestors);
          if (!optional) required.push(publicKey);
        }
        Object.defineProperty(properties, publicKey, {
          configurable: true,
          enumerable: true,
          value: propertySchema,
          writable: true,
        });
      }
      return {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
        additionalProperties: false,
      };
    }
    case "record": {
      if (strict) {
        return { type: "object", properties: {}, required: [], additionalProperties: false };
      }
      const valueType = definition.valueType as ZodType | undefined;
      return {
        type: "object",
        additionalProperties: valueType
          ? officialJsonSchema(valueType, false, nextAncestors)
          : true,
      };
    }
    case "optional": {
      const inner = definition.innerType as ZodType | undefined;
      return inner ? officialJsonSchema(inner, strict, nextAncestors) : {};
    }
    case "nullable": {
      const inner = definition.innerType as ZodType | undefined;
      return inner
        ? { anyOf: [officialJsonSchema(inner, strict, nextAncestors), { type: "null" }] }
        : { type: "null" };
    }
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional": {
      const inner = definition.innerType as ZodType | undefined;
      return inner ? officialJsonSchema(inner, strict, nextAncestors) : {};
    }
    case "pipe": {
      const output = definition.out as ZodType | undefined;
      return output ? officialJsonSchema(output, strict, nextAncestors) : {};
    }
    case "union": {
      const options = definition.options as ZodType[] | undefined;
      return options
        ? {
            anyOf: options.map((option) => (
              officialJsonSchema(option, strict, nextAncestors)
            )),
          }
        : {};
    }
    case "lazy": {
      const getter = definition.getter as (() => ZodType) | undefined;
      return getter
        ? officialJsonSchema(getter(), strict, nextAncestors)
        : {};
    }
    case "any":
    case "unknown":
      return strict
        ? { type: "object", properties: {}, required: [], additionalProperties: false }
        : {};
    default:
      return {};
  }
}

function nextAppPromptTemplate(context: PromptContext): string {
  const { catalog, options, formatZodType } = context;
  const {
    system = "You are a client-rendered NextAppSpec 0.19.0 application generator.",
    customRules = [],
  } = options;
  const data = catalog as {
    components?: Record<
      string,
      {
        props?: unknown;
        description?: string;
        slots?: string[];
        events?: string[];
      }
    >;
    actions?: Record<string, { params?: unknown; description?: string }>;
  };
  const lines = [
    system,
    "",
    "OUTPUT FORMAT:",
    "Output JSONL (one JSON object per line) with RFC 6902 JSON Patch operations to build a client-rendered NextAppSpec 0.19.0 application.",
    "The spec defines routes, layouts, metadata, and state for the client runtime.",
    "",
    "Example output (each line is a separate JSON object):",
    "",
    `{"op":"add","path":"/metadata","value":{"title":{"default":"My App","template":"%s | My App"},"description":"A client-rendered application"}}`,
    `{"op":"add","path":"/layouts","value":{}}`,
    `{"op":"add","path":"/layouts/main","value":{"root":"shell","elements":{"shell":{"type":"AppShell","props":{},"children":["nav","slot"]},"nav":{"type":"NavBar","props":{"links":[{"href":"/","label":"Home"},{"href":"/about","label":"About"}]},"children":[]},"slot":{"type":"Slot","props":{},"children":[]}}}}`,
    `{"op":"add","path":"/routes","value":{}}`,
    `{"op":"add","path":"/routes/~1","value":{"layout":"main","metadata":{"title":"Home"},"page":{"root":"hero","elements":{"hero":{"type":"Card","props":{"title":"Welcome"},"children":[]}}}}}`,
    `{"op":"add","path":"/routes/~1about","value":{"layout":"main","metadata":{"title":"About"},"page":{"root":"content","elements":{"content":{"type":"Card","props":{"title":"About Us"},"children":[]}}}}}`,
    "",
    "SPEC STRUCTURE:",
    "The top-level spec has these fields:",
    "  - metadata: Root metadata (title template, description, openGraph, twitter)",
    "  - layouts: Reusable layout element trees. Each referenced layout MUST include a { type: 'Slot' } element.",
    "  - routes: Route definitions keyed by URL pattern",
    "  - state: Global initial state shared across routes",
    "",
    "ROUTES:",
    "Route keys use Next.js-compatible URL patterns:",
    "  - '/' - home page",
    "  - '/about' - static route",
    "  - '/blog/[slug]' - dynamic segment",
    "  - '/docs/[...path]' - catch-all segment",
    "  - '/settings/[[...path]]' - optional catch-all segment",
    "",
    "IMPORTANT: In JSON Patch paths, forward slashes in route keys must be escaped as ~1.",
    "  - Route '/' becomes path '/routes/~1'",
    "  - Route '/about' becomes path '/routes/~1about'",
    "  - Route '/blog/[slug]' becomes path '/routes/~1blog~1[slug]'",
    "",
    "Each route has:",
    "  - page: Required element tree (root + elements + optional state)",
    "  - metadata: Optional per-route metadata",
    "  - layout: Optional layout key referencing layouts",
    "  - loading: Optional loading element tree",
    "  - error: Optional error element tree",
    "  - notFound: Optional not-found element tree",
    "  - loader: Optional client loader name registered by the host",
    "  - staticParams: Optional list of string route-param records",
    "",
    "LAYOUTS:",
    "Layouts wrap page content and are reused through the route layout field.",
    "Every referenced layout MUST include a component with type 'Slot' where page content is rendered.",
    "",
    "METADATA:",
    "Root metadata sets defaults. Route metadata overrides per page.",
    "  - title: string or { default, template?, absolute? } (use %s in a title template)",
    "  - description: string",
    "  - keywords: string[]",
    "  - openGraph, twitter, robots, alternates, icons: NextAppSpec 0.19.0 metadata fields",
    "",
    "PAGE CONTENT:",
    "Each page uses the json-render element tree format: root, elements, and optional state.",
    "Elements have type, props, and optional children, visible, on, repeat, and watch fields.",
    "",
    "AVAILABLE COMPONENTS:",
  ];

  for (const [name, definition] of Object.entries(data.components ?? {})) {
    const props = definition.props
      ? formatZodType(definition.props as never)
      : "{}";
    const children = definition.slots?.length ? " [accepts children]" : "";
    const events = definition.events?.length
      ? ` [events: ${definition.events.join(", ")}]`
      : "";
    lines.push(
      `- ${name}: ${props}${definition.description ? ` - ${definition.description}` : ""}${children}${events}`,
    );
  }
  lines.push(
    "- Slot: {} - Layout page-content placeholder. Required in every referenced layout.",
  );
  lines.push(
    "- Link: { href: string, replace?: boolean, prefetch?: boolean, className?: string, style?: object } [accepts children] - Client navigation anchor.",
  );

  if (Object.keys(data.actions ?? {}).length > 0) {
    lines.push("", "AVAILABLE ACTIONS:");
    for (const [name, definition] of Object.entries(data.actions ?? {})) {
      const params = definition.params
        ? formatZodType(definition.params as never)
        : "{}";
      lines.push(
        `- ${name}: ${params}${definition.description ? ` - ${definition.description}` : ""}`,
      );
    }
  }

  lines.push(
    "",
    "BUILT-IN ACTIONS:",
    "- setState: Update a value in state. Params: { statePath: string, value: any }",
    "- pushState: Append an item to a state array. Params: { statePath: string, value: any, clearStatePath?: string }",
    "- removeState: Remove an item from a state array. Params: { statePath: string, index: number }",
    "- navigate: Navigate to a route. Params: { href: string }",
    "",
    "RULES:",
  );
  const baseRules = [
    "Output ONLY JSONL patches - one JSON object per line, no markdown, no code fences",
    "First add /metadata with app-level metadata including the title template",
    "Then add /layouts with reusable layout definitions (each referenced layout must have a Slot component)",
    "Then add /routes with each route's page, metadata, and layout reference",
    "Do not add fields outside NextAppSpec 0.19.0",
    "ONLY use components listed in AVAILABLE COMPONENTS (plus Slot and Link)",
    "Each element needs type and props; children is an array of child keys when present",
    "Use unique keys for element map entries",
    "Escape forward slashes in route keys as ~1 in JSON Patch paths",
    "Include realistic sample data in state for data-driven pages",
    "Use Link for navigation between routes",
    "Create a cohesive multi-page application with consistent layouts and navigation",
  ];
  for (const [index, rule] of [...baseRules, ...customRules].entries()) {
    lines.push(`${index + 1}. ${rule}`);
  }
  return lines.join("\n");
}

const elementTree = (s: SchemaBuilder) =>
  s.object({
    root: s.string(),
    elements: s.record(
      s.object({
        type: s.ref("catalog.components"),
        props: s.propsOf("catalog.components"),
        children: { ...s.array(s.string()), ...s.optional() },
        visible: { ...s.any(), ...s.optional() },
        on: { ...s.any(), ...s.optional() },
        repeat: { ...s.any(), ...s.optional() },
        watch: { ...s.any(), ...s.optional() },
      }),
    ),
    state: { ...s.record(s.any()), ...s.optional() },
  });

const metadata = (s: SchemaBuilder) =>
  s.object({
    title: { ...s.any(), ...s.optional() },
    description: { ...s.string(), ...s.optional() },
    keywords: { ...s.array(s.string()), ...s.optional() },
    openGraph: {
      ...s.object({
        title: { ...s.string(), ...s.optional() },
        description: { ...s.string(), ...s.optional() },
        images: { ...s.any(), ...s.optional() },
        type: { ...s.string(), ...s.optional() },
        url: { ...s.string(), ...s.optional() },
        siteName: { ...s.string(), ...s.optional() },
        locale: { ...s.string(), ...s.optional() },
      }),
      ...s.optional(),
    },
    twitter: {
      ...s.object({
        card: { ...s.string(), ...s.optional() },
        title: { ...s.string(), ...s.optional() },
        description: { ...s.string(), ...s.optional() },
        images: { ...s.any(), ...s.optional() },
        creator: { ...s.string(), ...s.optional() },
        site: { ...s.string(), ...s.optional() },
      }),
      ...s.optional(),
    },
    robots: { ...s.any(), ...s.optional() },
    alternates: {
      ...s.object({ canonical: { ...s.string(), ...s.optional() } }),
      ...s.optional(),
    },
    icons: { ...s.any(), ...s.optional() },
  });

const baseSchema = defineSchema(
  (s) => ({
    spec: s.object({
      metadata: { ...metadata(s), ...s.optional() },
      routes: s.record(
        s.object({
          page: elementTree(s),
          metadata: { ...metadata(s), ...s.optional() },
          layout: { ...s.string(), ...s.optional() },
          loading: { ...elementTree(s), ...s.optional() },
          error: { ...elementTree(s), ...s.optional() },
          notFound: { ...elementTree(s), ...s.optional() },
          loader: { ...s.string(), ...s.optional() },
          staticParams: { ...s.array(s.record(s.string())), ...s.optional() },
        }),
      ),
      layouts: { ...s.record(elementTree(s)), ...s.optional() },
      state: { ...s.record(s.any()), ...s.optional() },
    }),
    catalog: s.object({
      components: s.map({
        props: s.zod(),
        slots: s.array(s.string()),
        description: s.string(),
        example: s.any(),
      }),
      actions: s.map({
        params: s.zod(),
        description: s.string(),
      }),
    }),
  }),
  {
    promptTemplate: nextAppPromptTemplate,
    builtInActions: [
      {
        name: "setState",
        description:
          "Update a value in the state model at the given statePath. Params: { statePath: string, value: any }",
      },
      {
        name: "pushState",
        description:
          'Append an item to an array in state. Params: { statePath: string, value: any, clearStatePath?: string }. Value can contain {"$state":"/path"} refs and "$id" for auto IDs.',
      },
      {
        name: "removeState",
        description:
          "Remove an item from an array in state by index. Params: { statePath: string, index: number }",
      },
      {
        name: "navigate",
        description:
          "Navigate to a route within the app. Params: { href: string }",
      },
    ],
  },
);

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

function exactCatalogSchema(catalog: Catalog) {
  const data = catalogData(catalog);
  const catalogSchema = createCatalogAwareNextAppSpecSchema(data.components, data.actions);
  const exactSchema = nextAppSpecSchema.pipe(catalogSchema as never) as ZodType;
  return { catalogSchema, exactSchema };
}

const createBaseCatalog = baseSchema.createCatalog.bind(baseSchema);

const createCatalog: typeof baseSchema.createCatalog = ((catalogInput: never) => {
  const catalog = createBaseCatalog(catalogInput);
  const { catalogSchema, exactSchema } = exactCatalogSchema(catalog);
  return {
    schema,
    data: catalog.data,
    componentNames: catalog.componentNames,
    actionNames: catalog.actionNames,
    prompt: catalog.prompt,
    jsonSchema: (options: JsonSchemaOptions = {}) => officialJsonSchema(
      catalogSchema,
      options.strict ?? false,
    ),
    validate: (input: unknown) => {
      const result = exactSchema.safeParse(input);
      return result.success
        ? { success: true, data: result.data }
        : { success: false, error: result.error };
    },
    zodSchema: () => exactSchema,
    get _specType(): never {
      throw new Error("_specType is only for type inference");
    },
  } as never;
}) as typeof baseSchema.createCatalog;

export const schema: typeof baseSchema = {
  ...baseSchema,
  createCatalog,
};

export type NextSchema = typeof schema;
export const NEXT_APP_SPEC_COMPATIBILITY = "0.19.0" as const;
