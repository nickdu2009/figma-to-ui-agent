import { defineCatalog } from "@json-render/core";
import { schema } from "@next-app-runtime/client/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { websiteComponentDefinitions } from "./website-catalog";

const { Link: _runtimeOwnedLink, ...hostShadcnComponentDefinitions } =
  shadcnComponentDefinitions;
const compatibleShadcnComponentDefinitions = {
  ...hostShadcnComponentDefinitions,
  Stack: {
    ...hostShadcnComponentDefinitions.Stack,
    props: hostShadcnComponentDefinitions.Stack.props.partial(),
  },
};

export const catalog = defineCatalog(schema, {
  components: {
    ...compatibleShadcnComponentDefinitions,
    ...websiteComponentDefinitions,
  },
  actions: {},
});
