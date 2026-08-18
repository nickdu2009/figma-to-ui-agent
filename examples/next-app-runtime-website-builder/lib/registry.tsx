"use client";

import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { catalog } from "./catalog";
import { websiteComponents } from "./website-components";

const { Link: _runtimeOwnedLink, ...hostShadcnComponents } = shadcnComponents;
type HostStackContext = Parameters<typeof hostShadcnComponents.Stack>[0];
type HostStackProps = HostStackContext["props"];

const compatibleStack = (
  context: Omit<HostStackContext, "props"> & { props: Partial<HostStackProps> },
) => hostShadcnComponents.Stack({
  ...context,
  props: {
    direction: context.props.direction ?? null,
    gap: context.props.gap ?? null,
    align: context.props.align ?? null,
    justify: context.props.justify ?? null,
    className: context.props.className ?? null,
  },
});
const compatibleHostShadcnComponents = {
  ...hostShadcnComponents,
  Stack: compatibleStack,
};

export const { registry } = defineRegistry(catalog, {
  components: {
    ...compatibleHostShadcnComponents,
    ...websiteComponents,
  },
  actions: {},
});
