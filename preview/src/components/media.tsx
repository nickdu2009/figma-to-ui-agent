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
> = ({ props, children }) => {
  const frame = props.frame;
  const shouldCrop = frame !== null;
  const sourceWidth = props.sourceWidth ?? props.width;
  const sourceHeight = props.sourceHeight ?? props.height;
  const cropImageStyle =
    shouldCrop && frame
      ? {
          width: sourceWidth,
          height: sourceHeight,
          right: "auto",
          bottom: "auto",
          maxWidth: "none",
          transform: `translate(${-frame.x}px, ${-frame.y}px)`,
        }
      : undefined;
  return (
    <figure
      className="ui-pixel-overlay"
      data-ui-node-id={props.nodeId}
      style={{
        ...controlledStyle(props.style),
        width: frame ? frame.width : props.width,
        height: frame ? frame.height : props.height,
        pointerEvents: props.style?.pointerEvents ?? "none",
      }}
    >
      <img
        src={props.src}
        alt={props.alt}
        aria-hidden={children ? true : undefined}
        style={cropImageStyle}
      />
      {children ? (
        <div className="ui-pixel-overlay-content">{children}</div>
      ) : null}
    </figure>
  );
};

export const Icon: ComponentFn<typeof previewCatalog, "Icon"> = ({
  props,
}) => (
  <img
    className="ui-icon"
    data-ui-node-id={props.nodeId}
    src={props.src}
    alt={props.decorative ? "" : props.alt}
    aria-hidden={props.decorative}
    style={controlledStyle(props.style)}
  />
);

export const Avatar: ComponentFn<typeof previewCatalog, "Avatar"> = ({
  props,
}) => {
  if (props.src) {
    return (
      <img
        className="ui-avatar"
        data-ui-node-id={props.nodeId}
        src={props.src}
        alt={props.alt}
        style={controlledStyle(props.style)}
      />
    );
  }
  return (
    <span
      className="ui-avatar ui-avatar-initials"
      data-ui-node-id={props.nodeId}
      role="img"
      aria-label={props.alt}
      style={controlledStyle(props.style)}
    >
      {props.initials}
    </span>
  );
};
