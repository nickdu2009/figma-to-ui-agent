import { createElement, type CSSProperties } from "react";
import type { ComponentFn } from "@json-render/react";

import { previewCatalog } from "../../../src/preview/catalog.ts";
import {
  type ControlledStyle,
  controlledStyle,
} from "./controlled-style.ts";

function stackStyle(
  direction?: "horizontal" | "vertical",
  gap?: number | null,
  padding?: number | null,
  align?: "start" | "center" | "end" | "stretch" | null,
  style?: ControlledStyle | null,
): CSSProperties {
  return {
    ...controlledStyle(style),
    flexDirection: direction === "horizontal" ? "row" : "column",
    gap: gap ?? undefined,
    padding: padding ?? undefined,
    alignItems:
      align === "start"
        ? "flex-start"
        : align === "end"
          ? "flex-end"
          : align ?? undefined,
  };
}

export const Stack: ComponentFn<
  typeof previewCatalog,
  "Stack"
> = ({ props, children }) => (
  <div
    className="ui-stack"
    data-ui-node-id={props.nodeId}
    style={stackStyle(
      props.direction,
      props.gap,
      props.padding,
      props.align,
      props.style,
    )}
  >
    {children}
  </div>
);

export const Grid: ComponentFn<typeof previewCatalog, "Grid"> = ({
  props,
  children,
}) => (
  <div
    className="ui-grid"
    data-ui-node-id={props.nodeId}
    style={{
      gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`,
      gap: props.gap ?? undefined,
      ...controlledStyle(props.style),
    }}
  >
    {children}
  </div>
);

export const Section: ComponentFn<
  typeof previewCatalog,
  "Section"
> = ({ props, children }) =>
  createElement(
    props.semantic,
    {
      className: "ui-section",
      "data-ui-node-id": props.nodeId,
      style: controlledStyle(props.style),
    },
    children,
  );

export const Dialog: ComponentFn<
  typeof previewCatalog,
  "Dialog"
> = ({ props, children }) => (
  <section
    className="ui-dialog"
    data-ui-node-id={props.nodeId}
    role="dialog"
    aria-modal="true"
    aria-label={props.title}
    style={controlledStyle(props.style)}
  >
    <h2>{props.title}</h2>
    {children}
  </section>
);

export const Divider: ComponentFn<
  typeof previewCatalog,
  "Divider"
> = ({ props }) => (
  <hr
    className="ui-divider"
    data-ui-node-id={props.nodeId}
    style={controlledStyle(props.style)}
  />
);
