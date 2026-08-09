import type { ComponentFn } from "@json-render/react";
import type { KeyboardEvent } from "react";

import { previewCatalog } from "../../../src/preview/catalog.ts";
import { controlledStyle } from "./controlled-style.ts";

export const Image: ComponentFn<typeof previewCatalog, "Image"> = ({
  props,
  emit,
}) => {
  const framedImageStyle =
    props.style?.position === "absolute"
      ? ({
          maxWidth: "none",
          minHeight: 0,
        } as const)
      : undefined;
  return (
    <img
      className={`ui-image${props.actionable ? " is-actionable" : ""}`}
      data-ui-node-id={props.nodeId}
      data-ui-actionable={props.actionable ? "true" : undefined}
      src={props.src}
      alt={props.alt}
      role={props.actionable ? "button" : undefined}
      tabIndex={props.actionable ? 0 : undefined}
      onClick={() => {
        if (props.actionable) {
          emit("press");
        }
      }}
      onKeyDown={(event) => {
        if (!props.actionable) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          emit("press");
        }
      }}
      style={{
        objectFit: props.fit,
        ...controlledStyle(props.style),
        ...framedImageStyle,
      }}
    />
  );
};

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
        maxWidth: props.style?.position === "absolute" ? "none" : undefined,
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
  emit,
}) => {
  const actionProps = {
    tabIndex: props.actionable ? 0 : undefined,
    onClick: () => {
      if (props.actionable) {
        emit("press");
      }
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (!props.actionable) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        emit("press");
      }
    },
  };
  if (props.src) {
    return (
      <img
        className={`ui-icon${props.actionable ? " is-actionable" : ""}`}
        data-ui-node-id={props.nodeId}
        data-ui-actionable={props.actionable ? "true" : undefined}
        src={props.src}
        alt={props.decorative ? "" : props.alt}
        aria-hidden={props.actionable ? undefined : props.decorative}
        aria-label={
          props.actionable && props.decorative ? props.alt : undefined
        }
        role={props.actionable ? "button" : undefined}
        {...actionProps}
        style={controlledStyle(props.style)}
      />
    );
  }
  return (
    <span
      className={`ui-icon ui-icon-symbol ui-icon-symbol-${props.symbol}${
        props.actionable ? " is-actionable" : ""
      }`}
      data-ui-node-id={props.nodeId}
      data-ui-actionable={props.actionable ? "true" : undefined}
      aria-hidden={props.actionable ? undefined : props.decorative}
      role={
        props.actionable ? "button" : props.decorative ? undefined : "img"
      }
      aria-label={
        props.actionable || !props.decorative ? props.alt : undefined
      }
      {...actionProps}
      style={controlledStyle(props.style)}
    />
  );
};

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
