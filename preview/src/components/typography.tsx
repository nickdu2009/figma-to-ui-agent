import type { ComponentFn } from "@json-render/react";

import { previewCatalog } from "../../../src/preview/catalog.ts";
import { controlledStyle } from "./controlled-style.ts";

export const Text: ComponentFn<typeof previewCatalog, "Text"> = ({
  props,
}) => {
  const Tag = props.variant === "heading" ? "h1" : "p";
  return (
    <Tag
      className={`ui-text ui-text-${props.variant}`}
      data-ui-node-id={props.nodeId}
      style={controlledStyle(props.style)}
    >
      {props.text}
    </Tag>
  );
};
