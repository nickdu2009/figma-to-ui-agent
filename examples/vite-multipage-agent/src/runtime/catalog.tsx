import { defineCatalog } from "@json-render/core";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { schema } from "@next-app-runtime/client/schema";

// The runtime owns Link (and Slot) as built-in components. The model-facing
// catalog therefore adopts every @json-render/shadcn 0.19.0 definition except
// Link: exactly 35 components, with no custom business components.
const { Link: _runtimeOwnedLinkDefinition, ...modelComponentDefinitions } =
  shadcnComponentDefinitions;
const { Link: _runtimeOwnedLinkComponent, ...modelComponents } =
  shadcnComponents;

export const catalog = defineCatalog(schema, {
  components: modelComponentDefinitions,
  actions: {},
});

export const { registry } = defineRegistry(catalog, {
  components: modelComponents,
});
