import { createElement, type CSSProperties } from "react";
import { useStateValue, type ComponentFn } from "@json-render/react";

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
> = ({ props, children, emit }) => {
  const pointerTransparent =
    !props.actionable && props.style?.position === "absolute";
  return (
    <div
      className={`ui-stack${props.actionable ? " is-actionable" : ""}${
        pointerTransparent ? " is-pointer-transparent" : ""
      }${props.actionWrapper ? " is-action-wrapper" : ""}`}
      data-ui-node-id={props.nodeId}
      data-ui-actionable={props.actionable ? "true" : undefined}
      role={props.actionable ? "button" : undefined}
      tabIndex={props.actionable ? 0 : undefined}
      onClick={(event) => {
        if (!props.actionable) {
          return;
        }
        const target = event.target;
        const nestedActionable =
          target instanceof HTMLElement
            ? target.closest('[data-ui-actionable="true"]')
            : null;
        if (
          nestedActionable instanceof HTMLElement &&
          nestedActionable !== event.currentTarget
        ) {
          return;
        }
        if (
          target instanceof HTMLElement &&
          target.closest("input,select,textarea,[role='switch']")
        ) {
          return;
        }
        emit("press");
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
};

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
      "data-semantic": props.semantic,
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

export const Conditional: ComponentFn<
  typeof previewCatalog,
  "Conditional"
> = ({ props, children }) => {
  const currentValue = useStateValue<string | number | boolean>(
    `/${props.stateKey}`,
  );
  if (currentValue !== props.equals) {
    return (
      <div
        className="ui-conditional"
        data-ui-node-id={props.nodeId}
        hidden
      />
    );
  }
  return <>{children}</>;
};

export const Spacer: ComponentFn<typeof previewCatalog, "Spacer"> = ({
  props,
}) => (
  <div
    className="ui-spacer"
    data-ui-node-id={props.nodeId}
    style={{
      width: props.width ?? undefined,
      height: props.height ?? undefined,
      ...controlledStyle(props.style),
    }}
  />
);

export const Card: ComponentFn<typeof previewCatalog, "Card"> = ({
  props,
  children,
}) => (
  <div
    className="ui-card"
    data-ui-node-id={props.nodeId}
    style={controlledStyle(props.style)}
  >
    {children}
  </div>
);

export const List: ComponentFn<typeof previewCatalog, "List"> = ({
  props,
  children,
}) =>
  createElement(
    props.ordered ? "ol" : "ul",
    {
      className: "ui-list",
      "data-ui-node-id": props.nodeId,
      style: controlledStyle(props.style),
    },
    children,
  );

export const ListItem: ComponentFn<typeof previewCatalog, "ListItem"> = ({
  props,
  children,
}) => (
  <li
    className="ui-list-item"
    data-ui-node-id={props.nodeId}
    style={controlledStyle(props.style)}
  >
    {children}
  </li>
);

export const Badge: ComponentFn<typeof previewCatalog, "Badge"> = ({
  props,
}) => (
  <span
    className={`ui-badge ui-badge-${props.tone ?? "neutral"}`}
    data-ui-node-id={props.nodeId}
    style={controlledStyle(props.style)}
  >
    {props.label}
  </span>
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
