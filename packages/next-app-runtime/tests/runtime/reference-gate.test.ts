import { describe, expect, it } from "vitest";

import { assertReferences } from "../../src/validation/reference-gate.js";
import { createRuntimeWithNavigation } from "../../src/runtime/create-runtime.js";
import { createMemoryNavigation } from "../../src/testing/memory-navigation.js";
import {
  testCatalog,
  testFallbacks,
  testLimits,
  testRegistry,
} from "../../src/testing/fixtures.js";
import type { NextAppSpec, RuntimeError } from "../../src/contract/types.js";

function specWithPage(
  root: string,
  elements: NextAppSpec["routes"][string]["page"]["elements"],
): NextAppSpec {
  return {
    routes: {
      "/": {
        page: { root, elements },
      },
    },
  };
}

describe("reference gate reachability", () => {
  it("allows orphaned elements and unreachable cycles", () => {
    const spec = specWithPage("root", {
      root: { type: "Text", props: { text: "Visible" } },
      orphan: {
        type: "Text",
        props: { text: "Unused" },
        children: ["orphan"],
      },
    });

    expect(() => assertReferences(spec, ["Text"], [])).not.toThrow();
  });

  it.each([
    [
      "a missing root",
      specWithPage("missing", {
        orphan: { type: "Text", props: { text: "Unused" } },
      }),
    ],
    [
      "a missing reachable child",
      specWithPage("root", {
        root: { type: "Text", props: { text: "Visible" }, children: ["missing"] },
      }),
    ],
    [
      "a reachable cycle",
      specWithPage("root", {
        root: { type: "Text", props: { text: "Visible" }, children: ["child"] },
        child: { type: "Text", props: { text: "Child" }, children: ["root"] },
      }),
    ],
  ])("still rejects %s", (_label, spec) => {
    expect(() => assertReferences(spec, ["Text"], [])).toThrowError(
      expect.objectContaining({ code: "references_invalid" }),
    );
  });

  it("does not count an orphaned Slot as a layout Slot", () => {
    const spec: NextAppSpec = {
      layouts: {
        main: {
          root: "shell",
          elements: {
            shell: { type: "Stack", props: {} },
            orphanedSlot: { type: "Slot", props: {} },
          },
        },
      },
      routes: {
        "/": {
          layout: "main",
          page: {
            root: "page",
            elements: {
              page: { type: "Text", props: { text: "Page" } },
            },
          },
        },
      },
    };

    expect(() => assertReferences(spec, ["Stack", "Text"], [])).toThrowError(
      expect.objectContaining({ code: "slot_missing" }),
    );
  });

  it("does not serialize source-controlled reference values", async () => {
    const sensitive = {
      action: "https://action-user:action-password@private.example/?token=action-secret",
      child: "https://child-user:child-password@private.example/?token=child-secret",
      component: "https://component-user:component-password@private.example/?token=component-secret",
      key: "https://key-user:key-password@private.example/?token=key-secret",
      layout: "https://layout-user:layout-password@private.example/?token=layout-secret",
      pattern: "/https://pattern-user:pattern-password@private.example/?token=pattern-secret",
    };
    const cases: Array<{
      spec: NextAppSpec;
      referenceCode: string;
      referenceMessage: string;
      runtimeCode: string;
      runtimeMessage: string;
    }> = [
      {
        referenceCode: "references_invalid",
        referenceMessage: "Element child reference is missing",
        runtimeCode: "references_invalid",
        runtimeMessage: "Element child reference is missing",
        spec: {
          routes: {
            [sensitive.pattern]: {
              page: {
                root: sensitive.key,
                elements: {
                  [sensitive.key]: {
                    type: "Text",
                    props: { text: "Missing child" },
                    children: [sensitive.child],
                  },
                },
              },
            },
          },
        },
      },
      {
        referenceCode: "references_invalid",
        referenceMessage: "Element type is not in the catalog",
        runtimeCode: "catalog_invalid",
        runtimeMessage: "Element type is not in the host catalog",
        spec: {
          routes: {
            [sensitive.pattern]: {
              page: {
                root: sensitive.key,
                elements: {
                  [sensitive.key]: { type: sensitive.component, props: {} },
                },
              },
            },
          },
        },
      },
      {
        referenceCode: "references_invalid",
        referenceMessage: "Action is not in the catalog",
        runtimeCode: "catalog_invalid",
        runtimeMessage: "Action is not in the host catalog",
        spec: {
          routes: {
            [sensitive.pattern]: {
              page: {
                root: sensitive.key,
                elements: {
                  [sensitive.key]: {
                    type: "Text",
                    props: { text: "Unknown action" },
                    on: { press: { action: sensitive.action } },
                  },
                },
              },
            },
          },
        },
      },
      {
        referenceCode: "layout_missing",
        referenceMessage: "Route references a missing layout",
        runtimeCode: "layout_missing",
        runtimeMessage: "Route references a missing layout",
        spec: {
          routes: {
            [sensitive.pattern]: {
              layout: sensitive.layout,
              page: {
                root: sensitive.key,
                elements: {
                  [sensitive.key]: { type: "Text", props: { text: "Missing layout" } },
                },
              },
            },
          },
        },
      },
    ];

    for (const testCase of cases) {
      let referenceError: RuntimeError | undefined;
      try {
        assertReferences(testCase.spec, ["Text"], []);
      } catch (error) {
        referenceError = error as RuntimeError;
      }
      expect(referenceError).toMatchObject({
        code: testCase.referenceCode,
        message: testCase.referenceMessage,
      });
      const serializedReferenceError = JSON.stringify(referenceError);
      for (const value of Object.values(sensitive)) {
        expect(serializedReferenceError).not.toContain(value);
      }

      const runtime = createRuntimeWithNavigation({
        catalog: testCatalog,
        registry: testRegistry,
        limits: testLimits,
        fallbacks: testFallbacks,
      }, createMemoryNavigation());
      const result = await runtime.applySource({ kind: "object", value: testCase.spec });
      expect(result).toMatchObject({
        status: "rejected",
        error: {
          code: testCase.runtimeCode,
          message: testCase.runtimeMessage,
        },
      });
      if (result.status !== "rejected") {
        throw new Error("Expected reference validation to reject the source");
      }
      const serializedRuntimeError = JSON.stringify(result.error);
      for (const value of Object.values(sensitive)) {
        expect(serializedRuntimeError).not.toContain(value);
      }
      runtime.dispose();
    }
  });
});
