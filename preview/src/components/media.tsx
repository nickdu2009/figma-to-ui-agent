import type { ComponentFn } from "@json-render/react";

import { previewCatalog } from "../../../src/preview/catalog.ts";
import { controlledStyle } from "./controlled-style.ts";

export const Image: ComponentFn<typeof previewCatalog, "Image"> = ({
  props,
}) => (
  <img
    className="ui-image"
    data-ui-node-id={props.nodeId}
    src={props.src}
    alt={props.alt}
    style={{ objectFit: props.fit, ...controlledStyle(props.style) }}
  />
);

export const PixelOverlay: ComponentFn<
  typeof previewCatalog,
  "PixelOverlay"
> = ({ props, children }) => (
  <figure
    className="ui-pixel-overlay"
    data-ui-node-id={props.nodeId}
    style={{
      ...controlledStyle(props.style),
      width: props.width,
      height: props.height,
    }}
  >
    <img src={props.src} alt={props.alt} />
    {children}
  </figure>
);
