import { z } from "zod";
import type { ComponentRegistry } from "@json-render/react";

import { schema } from "../contract/schema.js";
import type {
  NextAppSpec,
  RuntimeFallbacks,
  RuntimeLimits,
} from "../contract/types.js";

export const testCatalog = schema.createCatalog({
  components: {
    Box: {
      props: z.object({ label: z.string().optional() }).strict(),
      slots: ["default"],
      description: "Test container",
      example: { label: "Example" },
    },
    Text: {
      props: z.object({ text: z.string() }).strict(),
      description: "Test text",
      example: { text: "Example" },
    },
  },
  actions: {},
});

export const testRegistry: ComponentRegistry = {
  Box: () => null,
  Text: () => null,
};

export const testLimits: RuntimeLimits = {
  maxBytes: 1_000_000,
  maxOperations: 1_000,
  maxDepth: 100,
  maxRoutes: 100,
  maxElementsPerTree: 1_000,
};

export const testFallbacks: RuntimeFallbacks = {
  loading: () => null,
  error: () => null,
  notFound: () => null,
  unmatched: () => null,
};

export function createTestSpec(overrides: Partial<NextAppSpec> = {}): NextAppSpec {
  return {
    routes: {
      "/": {
        page: {
          root: "root",
          elements: {
            root: { type: "Text", props: { text: "Home" } },
          },
        },
      },
    },
    ...overrides,
  };
}
