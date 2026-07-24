import {
  type ComponentFn,
  useBoundProp,
} from "@json-render/react";

import { previewCatalog } from "../../../src/preview/catalog.ts";
import { controlledStyle } from "./controlled-style.ts";

export const Button: ComponentFn<
  typeof previewCatalog,
  "Button"
> = ({ props, emit }) => (
  <button
    className={`ui-button ui-button-${props.variant}`}
    data-ui-node-id={props.nodeId}
    type="button"
    disabled={props.disabled}
    onClick={() => emit("press")}
    style={controlledStyle(props.style)}
  >
    {props.leadingIconSrc ? (
      <img
        className="ui-button-icon"
        src={props.leadingIconSrc}
        alt=""
        aria-hidden="true"
      />
    ) : null}
    <span>{props.label}</span>
    {props.trailingIconSrc ? (
      <img
        className="ui-button-icon"
        src={props.trailingIconSrc}
        alt=""
        aria-hidden="true"
      />
    ) : null}
  </button>
);

export const Input: ComponentFn<typeof previewCatalog, "Input"> = ({
  props,
  bindings,
}) => {
  const [value, setValue] = useBoundProp(
    props.value,
    bindings?.value,
  );
  const inputValue = typeof value === "string" ? value : "";
  return (
    <label
      className={`ui-field${props.disabled ? " is-disabled" : ""}`}
      data-ui-node-id={props.nodeId}
      style={controlledStyle(props.style)}
    >
      <span>{props.label}</span>
      <input
        type={props.inputType}
        value={inputValue}
        placeholder={props.placeholder ?? ""}
        disabled={props.disabled}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>
  );
};

export const Checkbox: ComponentFn<
  typeof previewCatalog,
  "Checkbox"
> = ({ props, bindings }) => {
  const [checked, setChecked] = useBoundProp(
    props.checked,
    bindings?.checked,
  );
  const inputChecked = typeof checked === "boolean" ? checked : false;
  return (
    <label
      className={`ui-checkbox${props.disabled ? " is-disabled" : ""}`}
      data-ui-node-id={props.nodeId}
      style={controlledStyle(props.style)}
    >
      <input
        type="checkbox"
        checked={inputChecked}
        disabled={props.disabled}
        onChange={(event) => setChecked(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
};
