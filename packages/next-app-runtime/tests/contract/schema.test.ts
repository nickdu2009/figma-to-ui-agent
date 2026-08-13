import { describe, expect, it } from "vitest";
import { z } from "zod";

import { schema } from "../../src/contract/schema.js";
import type { NextAppSpec } from "../../src/contract/types.js";
import { nextAppSpecSchema } from "../../src/contract/zod-schema.js";
import { assertCatalogSpec } from "../../src/validation/catalog-gate.js";
import { assertReferences } from "../../src/validation/reference-gate.js";

describe("NextAppSpec 0.19.0 contract", () => {
  it("accepts the minimal public shape", () => {
    expect(nextAppSpecSchema.parse({ routes: {} })).toEqual({ routes: {} });
  });

  it("keeps the exported schema representable as JSON Schema", () => {
    expect(() => z.toJSONSchema(nextAppSpecSchema)).not.toThrow();
    expect(z.toJSONSchema(nextAppSpecSchema)).toMatchObject({
      type: "object",
      required: ["routes"],
    });
  });

  it("preserves every public Spec element field", () => {
    const spec = {
      metadata: {
        title: { default: "Site", template: "%s | Site", absolute: "Absolute" },
        description: "Description",
        keywords: ["one"],
        openGraph: { title: "OG", images: ["/image.png"] },
        twitter: { card: "summary_large_image" as const, creator: "@site" },
        robots: { index: true, follow: false },
        alternates: { canonical: "/canonical" },
        icons: { icon: "/favicon.ico" },
      },
      routes: {
        "/items/[id]": {
          page: {
            root: "root",
            state: { rows: [{ id: "a" }], enabled: true },
            elements: {
              root: {
                type: "Box",
                props: { label: "Rows" },
                children: ["row"],
                visible: { $and: [{ $state: "/enabled" }, { $index: true, gte: 0 }] },
                on: {
                  press: {
                    action: "save",
                    params: { id: { $state: "/id" } },
                    confirm: { title: "Save", message: "Continue?", variant: "danger" as const },
                    onSuccess: { navigate: "/done" },
                    onError: { set: { failed: true } },
                    preventDefault: true,
                  },
                },
                repeat: { statePath: "/rows", key: "id" },
                watch: { "/enabled": [{ action: "refresh" }] },
              },
              row: { type: "Text", props: { text: "Row" } },
            },
          },
          metadata: { title: "Item" },
          layout: "main",
          loading: { root: "x", elements: { x: { type: "Text", props: { text: "Loading" } } } },
          error: { root: "x", elements: { x: { type: "Text", props: { text: "Error" } } } },
          notFound: { root: "x", elements: { x: { type: "Text", props: { text: "Missing" } } } },
          loader: "loadItem",
          staticParams: [{ id: "a" }],
        },
      },
      layouts: {
        main: {
          root: "slot",
          elements: { slot: { type: "Slot", props: {} } },
        },
      },
      state: { app: "ready" },
    };
    expect(nextAppSpecSchema.parse(spec)).toEqual(spec);
  });

  it("preserves own __proto__ keys in public Record values", () => {
    const spec = JSON.parse(`{
      "routes": {},
      "state": {
        "__proto__": { "role": "admin" },
        "nested": { "__proto__": { "enabled": true } }
      }
    }`);

    const parsed = nextAppSpecSchema.parse(spec);
    const state = parsed.state!;
    const nested = state.nested as Record<string, unknown>;

    expect(Object.hasOwn(state, "__proto__")).toBe(true);
    expect(state["__proto__"]).toEqual({ role: "admin" });
    expect(Object.hasOwn(nested, "__proto__")).toBe(true);
    expect(nested["__proto__"]).toEqual({ enabled: true });
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
  });

  it("reports literal reserved Record keys without private escape tokens", () => {
    const routes = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(routes, "__proto__", {
      configurable: true,
      enumerable: true,
      value: 42,
      writable: true,
    });

    const result = nextAppSpecSchema.safeParse({ routes });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected invalid routes");
    expect(result.error.issues[0]?.path).toEqual(["routes", "__proto__"]);
    expect(JSON.stringify(result.error.issues)).not.toContain(
      "next-app-runtime-record-key",
    );
  });

  it("does not make non-JSON objects valid while preserving Record keys", () => {
    expect(nextAppSpecSchema.safeParse({
      routes: {},
      state: { createdAt: new Date() },
    }).success).toBe(false);
  });

  it("rejects an unknown accessor without executing it during record-key mapping", () => {
    let getterCalls = 0;
    const spec = Object.defineProperty({ routes: {} }, "unknown", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("sensitive unknown getter");
      },
    });

    expect(nextAppSpecSchema.safeParse(spec).success).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it("does not execute an action params schema while constructing a Catalog", () => {
    const constructionFailure = new Error("params schema was executed during construction");

    expect(() => schema.createCatalog({
      components: {},
      actions: {
        save: {
          params: z.any().transform(() => {
            throw constructionFailure;
          }),
          description: "Save",
        },
      },
    })).not.toThrow();
  });

  it("validates omitted action params only when the binding is actually checked", () => {
    const actualValidationFailure = new Error("params schema actual validation failure");
    let providedValidations = 0;
    let throwingValidations = 0;
    const catalog = schema.createCatalog({
      components: {},
      actions: {
        required: {
          params: z.object({ id: z.string() }).strict(),
          description: "Required params",
        },
        optional: {
          params: z.object({ id: z.string().optional() }).strict(),
          description: "Optional params",
        },
        counted: {
          params: z
            .object({ id: z.string() })
            .strict()
            .transform((value) => {
              providedValidations += 1;
              return value;
            }),
          description: "Counted params",
        },
        throwing: {
          params: z.any().transform(() => {
            throwingValidations += 1;
            throw actualValidationFailure;
          }),
          description: "Throwing params",
        },
      },
    });
    const actionSpec = (
      action: string,
      params?: Record<string, unknown>,
    ) => ({
      routes: {
        "/": {
          page: {
            root: "button",
            elements: {
              button: {
                type: "Slot",
                props: {},
                on: {
                  press: params === undefined ? { action } : { action, params },
                },
              },
            },
          },
        },
      },
    });

    expect(providedValidations).toBe(0);
    expect(throwingValidations).toBe(0);

    const missingRequired = actionSpec("required");
    expect(catalog.validate(missingRequired).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, missingRequired)).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );

    const missingOptional = actionSpec("optional");
    expect(catalog.validate(missingOptional).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, missingOptional)).not.toThrow();

    const provided = actionSpec("counted", { id: "one" });
    expect(catalog.validate(provided).success).toBe(true);
    expect(providedValidations).toBe(1);
    providedValidations = 0;
    expect(() => assertCatalogSpec(catalog, provided)).not.toThrow();
    expect(providedValidations).toBe(1);

    const missingThrowing = actionSpec("throwing");
    expect(() => catalog.validate(missingThrowing)).toThrow(actualValidationFailure);
    expect(throwingValidations).toBe(1);
    throwingValidations = 0;
    expect(() => assertCatalogSpec(catalog, missingThrowing)).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
    expect(throwingValidations).toBe(1);
  });

  it.each([
    { routes: {}, source: {} },
    { routes: { "/": { page: { root: "x", elements: {} }, runtime: {} } } },
    { metadata: { title: "x", unknown: true }, routes: {} },
    {
      routes: {
        "/": {
          page: {
            root: "x",
            elements: {
              x: {
                type: "Text",
                props: { text: "x" },
                on: {
                  press: {
                    action: "save",
                    onSuccess: { action: "refresh", params: { unsupported: true } },
                  },
                },
              },
            },
          },
        },
      },
    },
  ])("rejects fields outside the public contract", (spec) => {
    expect(nextAppSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("uses the exact 0.19.0 contract for Catalog validation too", () => {
    const catalog = schema.createCatalog({
      components: {
        Text: {
          props: z.object({ text: z.string() }).strict(),
          slots: [],
          description: "Text",
          example: { text: "Example" },
        },
      },
      actions: {
        save: {
          params: z.object({ id: z.string() }).strict(),
          description: "Save an item",
        },
      },
    });
    const invalid = { metadata: { title: "Site", unknown: true }, routes: {} };

    expect(catalog.validate(invalid).success).toBe(false);
    expect(catalog.zodSchema().safeParse(invalid).success).toBe(false);
    expect(catalog.validate({
      routes: {
        "/": {
          page: {
            root: "link",
            elements: {
              link: { type: "Link", props: { href: "/", unsupported: true } },
            },
          },
        },
      },
    }).success).toBe(false);
    const actionSpec = (params: Record<string, unknown>) => ({
      routes: {
        "/": {
          page: {
            root: "text",
            elements: {
              text: {
                type: "Text",
                props: { text: "Save" },
                on: { press: { action: "save", params } },
              },
            },
          },
        },
      },
    });
    expect(catalog.validate(actionSpec({})).success).toBe(false);
    expect(catalog.validate(actionSpec({ id: "one" })).success).toBe(true);
    const jsonSchema = catalog.jsonSchema();
    expect(jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    const serialized = JSON.stringify(jsonSchema);
    expect(serialized).toContain('"const":"Text"');
    expect(serialized).toContain('"const":"Slot"');
    expect(serialized).toContain('"const":"Link"');
    expect(serialized).toContain('"const":"save"');
    expect(serialized).toContain('"id"');
    expect(serialized).toContain('"text"');
    for (const expression of [
      "$state",
      "$item",
      "$index",
      "$bindState",
      "$bindItem",
      "$cond",
      "$computed",
      "$template",
    ]) {
      expect(serialized).toContain(JSON.stringify(expression));
    }
  });

  it("represents host transform schemas as unconstrained JSON Schema nodes", () => {
    const catalog = schema.createCatalog({
      components: {
        Counter: {
          props: z
            .object({ count: z.string() })
            .transform((value) => ({ count: Number(value.count) })),
          slots: [],
          description: "Transformed counter",
          example: { count: "1" },
        },
      },
      actions: {},
    });

    expect(() => catalog.jsonSchema()).not.toThrow();
    expect(JSON.stringify(catalog.jsonSchema())).toContain('"const":"Counter"');
  });

  it("validates own __proto__ entries in nested host Catalog records", () => {
    const catalog = schema.createCatalog({
      components: {
        Lookup: {
          props: z.object({
            values: z.record(
              z.string().refine((key) => key !== "__proto__"),
              z.number(),
            ),
          }).strict(),
          slots: [],
          description: "Lookup",
          example: { values: {} },
        },
      },
      actions: {
        save: {
          params: z.object({
            values: z.record(z.string(), z.number()),
          }).strict(),
          description: "Save",
        },
      },
    });
    const spec = JSON.parse(`{
      "routes": {
        "/": {
          "page": {
            "root": "lookup",
            "elements": {
              "lookup": {
                "type": "Lookup",
                "props": { "values": { "__proto__": 1 } },
                "on": {
                  "press": {
                    "action": "save",
                    "params": { "values": { "__proto__": "not-a-number" } }
                  }
                }
              }
            }
          }
        }
      }
    }`);

    expect(catalog.validate(spec).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, spec)).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );

    const invalidValue = JSON.parse(`{
      "routes": {
        "/": {
          "page": {
            "root": "lookup",
            "elements": {
              "lookup": {
                "type": "Lookup",
                "props": { "values": { "ordinary": 1 } },
                "on": {
                  "press": {
                    "action": "save",
                    "params": { "values": { "__proto__": "not-a-number" } }
                  }
                }
              }
            }
          }
        }
      }
    }`);
    expect(catalog.validate(invalidValue).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, invalidValue)).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );

    const validOwnKey = JSON.parse(`{
      "routes": {
        "/": {
          "page": {
            "root": "lookup",
            "elements": {
              "lookup": {
                "type": "Lookup",
                "props": { "values": { "ordinary": 1 } },
                "on": {
                  "press": {
                    "action": "save",
                    "params": { "values": { "__proto__": 2 } }
                  }
                }
              }
            }
          }
        }
      }
    }`);
    const validResult = catalog.validate(validOwnKey);
    expect(validResult.success).toBe(true);
    expect(() => assertCatalogSpec(catalog, validOwnKey)).not.toThrow();
    if (!validResult.success || !validResult.data) {
      throw new Error("Expected legal own Record key");
    }
    const element = validResult.data.routes["/"]!.page.elements.lookup!;
    const bindings = element.on as Record<string, unknown> | undefined;
    const binding = bindings?.press as
      | { params?: Record<string, unknown> }
      | Array<{ params?: Record<string, unknown> }>
      | undefined;
    const action = Array.isArray(binding) ? binding[0] : binding;
    const values = action?.params?.values as Record<string, unknown>;
    expect(Object.hasOwn(values, "__proto__")).toBe(true);
    expect(values["__proto__"]).toBe(2);
  });

  it("executes a matching union transform once when validating a nested own key", () => {
    let transformCalls = 0;
    const catalog = schema.createCatalog({
      components: {
        Lookup: {
          props: z.union([
            z
              .object({
                kind: z.literal("record"),
                values: z.record(z.string(), z.number()),
              })
              .strict()
              .transform((value) => {
                transformCalls += 1;
                return value;
              }),
            z.object({ kind: z.literal("empty") }).strict(),
          ]),
          slots: [],
          description: "Union lookup",
          example: { kind: "empty" },
        },
      },
      actions: {},
    });
    const spec = JSON.parse(`{
      "routes": {
        "/": {
          "page": {
            "root": "lookup",
            "elements": {
              "lookup": {
                "type": "Lookup",
                "props": {
                  "kind": "record",
                  "values": { "__proto__": 1 }
                }
              }
            }
          }
        }
      }
    }`);

    expect(transformCalls).toBe(0);
    const result = catalog.validate(spec);
    expect(result.success).toBe(true);
    expect(transformCalls).toBe(1);
    transformCalls = 0;
    expect(() => assertCatalogSpec(catalog, spec)).not.toThrow();
    expect(transformCalls).toBe(1);
  });

  it("keeps direct expressions beside nested host record fields", () => {
    const catalog = schema.createCatalog({
      components: {
        Lookup: {
          props: z.object({
            values: z.record(z.string(), z.number()),
            label: z.string(),
          }).strict(),
          slots: [],
          description: "Expression lookup",
          example: { values: {}, label: "Lookup" },
        },
      },
      actions: {},
    });
    const spec = {
      routes: {
        "/": {
          page: {
            root: "lookup",
            elements: {
              lookup: {
                type: "Lookup",
                props: {
                  values: { $state: "/values" },
                  label: { $state: "/label" },
                },
              },
            },
          },
        },
      },
    };
    const expressionResult = catalog.validate(spec);
    expect(expressionResult.success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec)).not.toThrow();
  });

  it("validates own reserved keys inside lazy host schemas", () => {
    const catalog = schema.createCatalog({
      components: {
        Lookup: {
          props: z.lazy(() => z.object({
            values: z.record(z.string(), z.number()),
          }).strict()),
          slots: [],
          description: "Lazy lookup",
          example: { values: {} },
        },
      },
      actions: {},
    });
    const spec = (values: unknown) => ({
      routes: {
        "/": {
          page: {
            root: "lookup",
            elements: {
              lookup: { type: "Lookup", props: { values } },
            },
          },
        },
      },
    });
    const invalid = spec(JSON.parse(`{"__proto__":"not-a-number"}`));
    const dynamic = spec({ $state: "/values" });

    expect(catalog.validate(invalid).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, invalid)).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
    expect(catalog.validate(dynamic).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, dynamic)).not.toThrow();
  });

  it("does not expose spec-provided component or action names in Catalog errors", () => {
    const catalog = schema.createCatalog({ components: {}, actions: {} });
    const sensitiveComponent = "https://private.example/?credential=component-secret";
    const sensitiveAction = "Bearer action-secret";
    const specs: NextAppSpec[] = [
      {
        routes: {
          "/": {
            page: {
              root: "sensitive",
              elements: {
                sensitive: { type: sensitiveComponent, props: {} },
              },
            },
          },
        },
      },
      {
        routes: {
          "/": {
            page: {
              root: "slot",
              elements: {
                slot: {
                  type: "Slot",
                  props: {},
                  on: { press: { action: sensitiveAction } },
                },
              },
            },
          },
        },
      },
    ];

    for (const [index, spec] of specs.entries()) {
      try {
        assertCatalogSpec(catalog, spec);
        throw new Error("expected Catalog validation to fail");
      } catch (error) {
        expect(error).toMatchObject({ code: "catalog_invalid" });
        const serialized = JSON.stringify(error);
        expect(serialized).not.toContain(index === 0 ? "component-secret" : "action-secret");
        expect(serialized).not.toContain(index === 0 ? sensitiveComponent : sensitiveAction);
      }
    }
  });

  it("does not skip own __proto__ entries in structural Catalog records", () => {
    const catalog = schema.createCatalog({ components: {}, actions: {} });
    const specs = [
      JSON.parse(`{
        "routes": {
          "/": {
            "page": {
              "root": "slot",
              "elements": {
                "slot": {
                  "type": "Slot",
                  "props": {},
                  "on": {
                    "__proto__": { "action": "unknown" }
                  }
                }
              }
            }
          }
        }
      }`),
      JSON.parse(`{
        "routes": {
          "/": {
            "page": {
              "root": "slot",
              "elements": {
                "slot": { "type": "Slot", "props": {} },
                "__proto__": { "type": "unknown", "props": {} }
              }
            }
          }
        }
      }`),
    ] as NextAppSpec[];

    for (const spec of specs) {
      expect(catalog.validate(spec).success).toBe(false);
      expect(() => assertCatalogSpec(catalog, spec)).toThrowError(
        expect.objectContaining({ code: "catalog_invalid" }),
      );
    }
  });

  it("accepts every public 0.19.0 expression before host Catalog resolution", () => {
    const valueSchema = z
      .object({
        state: z.string(),
        item: z.string(),
        index: z.number(),
        bindState: z.string(),
        bindItem: z.string(),
        conditional: z.string(),
        computed: z.string(),
        template: z.string(),
        nested: z.object({ label: z.string() }).strict(),
        payload: z.object({ id: z.string(), tags: z.array(z.string()) }).strict(),
      })
      .strict()
      .refine((value) => value.state.startsWith("allowed"), "state prefix");
    const catalog = schema.createCatalog({
      components: {
        Fields: {
          props: valueSchema,
          slots: [],
          description: "Expression fields",
          example: {},
        },
      },
      actions: {
        save: {
          params: valueSchema,
          description: "Save expression fields",
        },
      },
    });
    const values = {
      state: { $state: "/state" },
      item: { $item: "name" },
      index: { $index: true },
      bindState: { $bindState: "/form/name" },
      bindItem: { $bindItem: "name" },
      conditional: {
        $cond: { $state: "/enabled" },
        $then: "enabled",
        $else: "disabled",
      },
      computed: { $computed: "fullName", args: { first: { $state: "/first" } } },
      template: { $template: "Hello ${/name}" },
      nested: { label: { $state: "/nested/label" } },
      payload: { id: "one", tags: ["a", "b"] },
    };
    type ExpressionActionBinding = {
      action: string;
      params: typeof values;
      onSuccess?: { action: string };
      onError?: { action: string };
    };
    const press: ExpressionActionBinding = { action: "save", params: values };
    const spec = {
      routes: {
        "/": {
          page: {
            root: "fields",
            elements: {
              fields: {
                type: "Fields",
                props: values,
                on: { press },
              },
            },
          },
        },
      },
    };

    expect(catalog.validate(spec).success).toBe(true);
    expect(catalog.zodSchema().safeParse(spec).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec)).not.toThrow();

    const invalidLiteral = structuredClone(spec);
    invalidLiteral.routes["/"].page.elements.fields.props.state = 42 as never;
    expect(catalog.validate(invalidLiteral).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, invalidLiteral)).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );

    const unknownComponent = structuredClone(spec);
    unknownComponent.routes["/"].page.elements.fields.type = "Unknown";
    expect(catalog.validate(unknownComponent).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, unknownComponent)).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );

    const unknownAction = structuredClone(spec);
    unknownAction.routes["/"].page.elements.fields.on.press.action = "unknown";
    expect(catalog.validate(unknownAction).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, unknownAction)).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );

    for (const followUp of ["onSuccess", "onError"] as const) {
      const unknownChainedAction = structuredClone(spec);
      unknownChainedAction.routes["/"].page.elements.fields.on.press[followUp] = {
        action: "unknown",
      };
      expect(catalog.validate(unknownChainedAction).success).toBe(false);
      expect(() => assertCatalogSpec(catalog, unknownChainedAction)).toThrowError(
        expect.objectContaining({ code: "catalog_invalid" }),
      );
      expect(() => assertReferences(
        unknownChainedAction,
        ["Fields"],
        ["save"],
      )).toThrowError(expect.objectContaining({ code: "references_invalid" }));
    }

    const knownChainedActions = structuredClone(spec);
    knownChainedActions.routes["/"].page.elements.fields.on.press.onSuccess = {
      action: "save",
    };
    knownChainedActions.routes["/"].page.elements.fields.on.press.onError = {
      action: "setState",
    };
    expect(catalog.validate(knownChainedActions).success).toBe(true);
    expect(() => assertReferences(knownChainedActions, ["Fields"], ["save"]))
      .not.toThrow();
  });

  it("enforces Catalog refinements that only read static sibling literals", () => {
    const catalog = schema.createCatalog({
      components: {
        Counter: {
          props: z
            .object({ label: z.string(), count: z.number() })
            .strict()
            .refine(
              (value) => value.label.startsWith("allowed"),
              "label prefix",
            )
            .refine((value) => value.count > 0, "count must be positive"),
          slots: [],
          description: "Counter",
          example: { label: "Items", count: 1 },
        },
      },
      actions: {},
    });
    const spec = (count: number) => ({
      routes: {
        "/": {
          page: {
            root: "counter",
            elements: {
              counter: {
                type: "Counter",
                props: { label: { $state: "/label" }, count },
              },
            },
          },
        },
      },
    });

    expect(catalog.validate(spec(1)).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec(1))).not.toThrow();
    expect(catalog.validate(spec(-1)).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, spec(-1))).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
  });

  it("preserves static Catalog overwrite order before refinements", () => {
    const catalog = schema.createCatalog({
      components: {
        Counter: {
          props: z
            .object({ label: z.string(), count: z.number() })
            .strict()
            .overwrite((value) => {
              value.count += 1;
              return value;
            })
            .refine((value) => value.count > 0, "count must be positive"),
          slots: [],
          description: "Counter",
          example: { label: "Items", count: 1 },
        },
      },
      actions: {},
    });
    const spec = (count: number) => ({
      routes: {
        "/": {
          page: {
            root: "counter",
            elements: {
              counter: {
                type: "Counter",
                props: { label: { $state: "/label" }, count },
              },
            },
          },
        },
      },
    });

    expect(catalog.validate(spec(0)).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec(0))).not.toThrow();
    expect(catalog.validate(spec(-1)).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, spec(-1))).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
  });

  it("enforces static refinements on expression-aware container schemas", () => {
    const expression = { $state: "/dynamic" };
    const cases: Array<{
      name: string;
      container: z.ZodType;
      valid: unknown;
      invalid: unknown;
    }> = [
      {
        name: "array",
        container: z.array(z.number()).refine((value) => value.length <= 2),
        valid: [expression, 1],
        invalid: [expression, 1, 2],
      },
      {
        name: "record",
        container: z
          .record(z.string(), z.number())
          .refine((value) => Object.keys(value).length <= 1),
        valid: { dynamic: expression },
        invalid: { dynamic: expression, extra: 1 },
      },
      {
        name: "tuple",
        container: z
          .tuple([z.number(), z.number()])
          .refine((value) => value[1] > 0),
        valid: [expression, 1],
        invalid: [expression, -1],
      },
      {
        name: "union",
        container: z
          .union([
            z
              .object({ kind: z.literal("a"), dynamic: z.string(), count: z.number() })
              .strict(),
            z
              .object({ kind: z.literal("b"), dynamic: z.string(), count: z.number() })
              .strict(),
          ])
          .refine((value) => value.count > 0),
        valid: { kind: "a", dynamic: expression, count: 1 },
        invalid: { kind: "a", dynamic: expression, count: -1 },
      },
      {
        name: "intersection",
        container: z
          .intersection(
            z.object({ dynamic: z.string() }).passthrough(),
            z.object({ count: z.number() }).passthrough(),
          )
          .refine((value) => value.count > 0),
        valid: { dynamic: expression, count: 1 },
        invalid: { dynamic: expression, count: -1 },
      },
    ];

    for (const testCase of cases) {
      const catalog = schema.createCatalog({
        components: {
          Probe: {
            props: z.object({ value: testCase.container }).strict(),
            slots: [],
            description: testCase.name,
            example: {},
          },
        },
        actions: {},
      });
      const spec = (props: unknown) => ({
        routes: {
          "/": {
            page: {
              root: "probe",
              elements: { probe: { type: "Probe", props: { value: props } } },
            },
          },
        },
      });

      expect(catalog.validate(spec(testCase.valid)).success, testCase.name).toBe(true);
      expect(() => assertCatalogSpec(catalog, spec(testCase.valid)), testCase.name)
        .not.toThrow();
      expect(catalog.validate(spec(testCase.invalid)).success, testCase.name).toBe(false);
      expect(() => assertCatalogSpec(catalog, spec(testCase.invalid)), testCase.name)
        .toThrowError(expect.objectContaining({ code: "catalog_invalid" }));
    }
  });

  it("preserves container overwrite order before static refinements", () => {
    const catalog = schema.createCatalog({
      components: {
        Probe: {
          props: z
            .object({
              values: z
                .array(z.number())
                .overwrite((value) => value.length === 2 ? [value[1]!] : value)
                .refine((value) => value[0]! > 0),
            })
            .strict(),
          slots: [],
          description: "Container overwrite",
          example: { values: [0, 1] },
        },
      },
      actions: {},
    });
    const spec = (count: number) => ({
      routes: {
        "/": {
          page: {
            root: "probe",
            elements: {
              probe: {
                type: "Probe",
                props: { values: [{ $state: "/dynamic" }, count] },
              },
            },
          },
        },
      },
    });

    expect(catalog.validate(spec(1)).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec(1))).not.toThrow();
    expect(catalog.validate(spec(0)).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, spec(0))).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
  });

  it("defers opaque refinements but still checks static siblings", () => {
    const catalog = schema.createCatalog({
      components: {
        Counter: {
          props: z
            .object({ label: z.string(), count: z.number() })
            .strict()
            .refine(
              (value) => structuredClone(value).label.startsWith("allowed"),
              "label prefix",
            )
            .refine((value) => value.count > 0, "count must be positive"),
          slots: [],
          description: "Opaque refinement",
          example: { label: "allowed", count: 1 },
        },
      },
      actions: {},
    });
    const spec = (count: number) => ({
      routes: {
        "/": {
          page: {
            root: "counter",
            elements: {
              counter: {
                type: "Counter",
                props: { label: { $state: "/label" }, count },
              },
            },
          },
        },
      },
    });

    expect(() => catalog.validate(spec(1))).not.toThrow();
    expect(catalog.validate(spec(1)).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec(1))).not.toThrow();
    expect(catalog.validate(spec(-1)).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, spec(-1))).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
  });

  it("does not defer a static refinement exception because of an unrelated expression", () => {
    const staticFailure = new Error("static refinement failed");
    const catalog = schema.createCatalog({
      components: {
        Counter: {
          props: z
            .object({ label: z.string(), count: z.number() })
            .strict()
            .refine((value) => {
              if (value.count < 0) throw staticFailure;
              return true;
            }),
          slots: [],
          description: "Throwing static refinement",
          example: { label: "Count", count: 1 },
        },
      },
      actions: {},
    });
    const spec = (label: unknown) => ({
      routes: {
        "/": {
          page: {
            root: "counter",
            elements: {
              counter: {
                type: "Counter",
                props: { label, count: -1 },
              },
            },
          },
        },
      },
    });

    for (const label of ["literal", { $state: "/label" }]) {
      expect(() => catalog.validate(spec(label))).toThrow(staticFailure);
      expect(() => assertCatalogSpec(catalog, spec(label))).toThrowError(
        expect.objectContaining({ code: "catalog_invalid" }),
      );
    }
  });

  it("accepts expressions in typed object catchall values", () => {
    const catalog = schema.createCatalog({
      components: {
        Fields: {
          props: z.object({ label: z.string() }).catchall(z.number()),
          slots: [],
          description: "Typed catchall",
          example: { label: "Value", count: 1 },
        },
      },
      actions: {},
    });
    const spec = (value: unknown) => ({
      routes: {
        "/": {
          page: {
            root: "fields",
            elements: {
              fields: {
                type: "Fields",
                props: { label: "Value", count: value },
              },
            },
          },
        },
      },
    });

    expect(catalog.validate(spec(1)).success).toBe(true);
    expect(catalog.validate(spec("invalid")).success).toBe(false);
    const expressions = [
      { $state: "/count" },
      { $item: "count" },
      { $index: true },
      { $bindState: "/count" },
      { $bindItem: "count" },
      { $cond: { $state: "/enabled" }, $then: 1, $else: 0 },
      { $computed: "count", args: { value: { $state: "/count" } } },
      { $template: "${/count}" },
    ];
    for (const expression of expressions) {
      expect(catalog.validate(spec(expression)).success).toBe(true);
      expect(() => assertCatalogSpec(catalog, spec(expression))).not.toThrow();
    }
  });

  it("preserves strict, strip, and passthrough object modes", () => {
    const spec = (type: string) => ({
      routes: {
        "/": {
          page: {
            root: "value",
            elements: {
              value: {
                type,
                props: { label: "Value", extra: { $state: "/extra" } },
              },
            },
          },
        },
      },
    });
    const catalog = schema.createCatalog({
      components: {
        Strict: {
          props: z.object({ label: z.string() }).strict(),
          slots: [],
          description: "Strict",
          example: { label: "Value" },
        },
        Strip: {
          props: z.object({ label: z.string() }),
          slots: [],
          description: "Strip",
          example: { label: "Value" },
        },
        Passthrough: {
          props: z.object({ label: z.string() }).passthrough(),
          slots: [],
          description: "Passthrough",
          example: { label: "Value" },
        },
      },
      actions: {},
    });

    expect(catalog.validate(spec("Strict")).success).toBe(false);
    expect(catalog.validate(spec("Strip")).success).toBe(true);
    expect(catalog.validate(spec("Passthrough")).success).toBe(true);
  });

  it("preserves statically decidable pipe output constraints", () => {
    const catalog = schema.createCatalog({
      components: {
        Counter: {
          props: z
            .object({ label: z.string(), count: z.number() })
            .strict()
            .transform((value) => ({ count: value.count }))
            .pipe(z.object({ count: z.number().positive() }).strict()),
          slots: [],
          description: "Piped counter",
          example: { label: "Count", count: 1 },
        },
      },
      actions: {},
    });
    const spec = (count: number) => ({
      routes: {
        "/": {
          page: {
            root: "counter",
            elements: {
              counter: {
                type: "Counter",
                props: { label: { $state: "/label" }, count },
              },
            },
          },
        },
      },
    });

    expect(catalog.validate(spec(1)).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec(1))).not.toThrow();
    expect(catalog.validate(spec(-1)).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, spec(-1))).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
  });

  it("defers identity pipe outputs without leaking internal expression sentinels", () => {
    const catalog = schema.createCatalog({
      components: {
        Label: {
          props: z
            .object({ label: z.string(), count: z.number() })
            .strict()
            .transform((value) => value)
            .pipe(
              z.object({ label: z.string(), count: z.number().positive() }).strict(),
            ),
          slots: [],
          description: "Identity-piped label",
          example: { label: "Label", count: 1 },
        },
      },
      actions: {},
    });
    const spec = (count: number) => ({
      routes: {
        "/": {
          page: {
            root: "label",
            elements: {
              label: {
                type: "Label",
                props: { label: { $state: "/label" }, count },
              },
            },
          },
        },
      },
    });

    expect(() => catalog.validate(spec(1))).not.toThrow();
    expect(catalog.validate(spec(1)).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec(1))).not.toThrow();
    expect(catalog.validate(spec(-1)).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, spec(-1))).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
  });

  it("runs codec transforms before enforcing statically decidable output constraints", () => {
    const decodeFailure = new Error("count cannot be decoded");
    const catalog = schema.createCatalog({
      components: {
        Counter: {
          props: z.codec(
            z.object({ label: z.string(), count: z.string() }).strict(),
            z.object({ count: z.number().positive() }).strict(),
            {
              decode: (value) => {
                if (value.count === "bad") throw decodeFailure;
                return { count: Number(value.count) };
              },
              encode: (value) => ({ label: "Count", count: String(value.count) }),
            },
          ),
          slots: [],
          description: "Codec counter",
          example: { label: "Count", count: "1" },
        },
      },
      actions: {},
    });
    const spec = (count: string, label: unknown = { $state: "/label" }) => ({
      routes: {
        "/": {
          page: {
            root: "counter",
            elements: {
              counter: {
                type: "Counter",
                props: { label, count },
              },
            },
          },
        },
      },
    });

    expect(catalog.validate(spec("1")).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec("1"))).not.toThrow();
    expect(catalog.validate(spec("-1")).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, spec("-1"))).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
    expect(() => catalog.validate(spec("bad", "Count"))).toThrow(decodeFailure);
    expect(() => catalog.validate(spec("bad"))).toThrow(decodeFailure);
    expect(() => assertCatalogSpec(catalog, spec("bad"))).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
  });

  it("defers proxy-incompatible opaque pipe transforms", () => {
    const catalog = schema.createCatalog({
      components: {
        Label: {
          props: z
            .object({ label: z.string() })
            .strict()
            .transform((value) => structuredClone(value))
            .pipe(z.object({ label: z.string() }).strict()),
          slots: [],
          description: "Opaque-piped label",
          example: { label: "Label" },
        },
      },
      actions: {},
    });
    const spec = {
      routes: {
        "/": {
          page: {
            root: "label",
            elements: {
              label: {
                type: "Label",
                props: { label: { $state: "/label" } },
              },
            },
          },
        },
      },
    };

    expect(() => catalog.validate(spec)).not.toThrow();
    expect(catalog.validate(spec).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec)).not.toThrow();
  });

  it("preserves exclusive-union semantics with unrelated dynamic expressions", () => {
    const exclusiveProps = z.xor([
      z.object({ a: z.string() }).passthrough(),
      z.object({ b: z.string() }).passthrough(),
    ]);
    const catalog = schema.createCatalog({
      components: {
        Exclusive: {
          props: exclusiveProps,
          slots: [],
          description: "Exclusive props",
          example: { a: "one" },
        },
      },
      actions: {},
    });
    const props = { a: "one", b: "two", dynamic: { $state: "/dynamic" } };
    const spec = {
      routes: {
        "/": {
          page: {
            root: "exclusive",
            elements: { exclusive: { type: "Exclusive", props } },
          },
        },
      },
    };

    expect(exclusiveProps.safeParse(props).success).toBe(false);
    expect(catalog.validate({
      routes: {
        "/": {
          page: {
            root: "exclusive",
            elements: {
              exclusive: {
                type: "Exclusive",
                props: { a: "one", dynamic: { $state: "/dynamic" } },
              },
            },
          },
        },
      },
    }).success).toBe(true);
    expect(catalog.validate(spec).success).toBe(false);
    expect(() => assertCatalogSpec(catalog, spec)).toThrowError(
      expect.objectContaining({ code: "catalog_invalid" }),
    );
  });

  it("defers pipe transforms that depend on unresolved expressions", () => {
    const catalog = schema.createCatalog({
      components: {
        Label: {
          props: z
            .object({ label: z.string() })
            .strict()
            .transform((value) => ({ label: value.label.toUpperCase() }))
            .pipe(z.object({ label: z.string().min(1) }).strict()),
          slots: [],
          description: "Piped label",
          example: { label: "Label" },
        },
      },
      actions: {},
    });
    const spec = {
      routes: {
        "/": {
          page: {
            root: "label",
            elements: {
              label: {
                type: "Label",
                props: { label: { $state: "/label" } },
              },
            },
          },
        },
      },
    };

    expect(catalog.validate(spec).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec)).not.toThrow();
  });

  it("accepts structured JSON literals in action params", () => {
    const spec = {
      routes: {
        "/": {
          page: {
            root: "text",
            elements: {
              text: {
                type: "Text",
                props: { text: "Save" },
                on: {
                  press: {
                    action: "save",
                    params: {
                      payload: { id: "one", tags: ["a", "b"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(nextAppSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("defers discriminated Catalog choices when the discriminator is dynamic", () => {
    const catalog = schema.createCatalog({
      components: {
        Choice: {
          props: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("text"), value: z.string() }).strict(),
            z.object({ kind: z.literal("count"), value: z.number() }).strict(),
          ]),
          slots: [],
          description: "Choice",
          example: { kind: "text", value: "Example" },
        },
      },
      actions: {},
    });
    const spec = {
      routes: {
        "/": {
          page: {
            root: "choice",
            elements: {
              choice: {
                type: "Choice",
                props: { kind: { $state: "/kind" }, value: { $state: "/value" } },
              },
            },
          },
        },
      },
    };

    expect(catalog.validate(spec).success).toBe(true);
    expect(() => assertCatalogSpec(catalog, spec)).not.toThrow();
  });

  it("documents the official 0.19.0 JSONL flow without server claims", () => {
    const catalog = schema.createCatalog({
      components: {
        Text: {
          props: z.object({ text: z.string() }).strict(),
          slots: [],
          description: "Text",
          example: { text: "Example" },
        },
      },
      actions: {
        save: {
          params: z.object({ id: z.string() }).strict(),
          description: "Save an item",
        },
      },
    });
    const prompt = catalog.prompt();

    expect(prompt).toContain("Example output (each line is a separate JSON object):");
    expect(prompt).toContain('{"op":"add","path":"/metadata"');
    expect(prompt).toContain('{"op":"add","path":"/layouts"');
    expect(prompt).toContain('{"op":"add","path":"/routes"');
    expect(prompt).toContain("Route '/blog/[slug]' becomes path '/routes/~1blog~1[slug]'");
    expect(prompt.indexOf('"path":"/metadata"')).toBeLessThan(prompt.indexOf('"path":"/layouts"'));
    expect(prompt.indexOf('"path":"/layouts"')).toBeLessThan(prompt.indexOf('"path":"/routes"'));
    expect(prompt).toContain("- save: { id: string } - Save an item");
    expect(prompt).toContain("Params: { statePath: string, value: any }");
    expect(prompt).toContain("Params: { statePath: string, value: any, clearStatePath?: string }");
    expect(prompt).toContain("Params: { statePath: string, index: number }");
    expect(prompt).toContain("Params: { href: string }");
    expect(prompt).not.toMatch(/server-side|SSR|next\/link/i);
  });
});
