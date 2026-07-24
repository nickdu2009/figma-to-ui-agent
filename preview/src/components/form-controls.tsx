import {
  type ComponentFn,
  useBoundProp,
  useStateStore,
  useStateValue,
} from "@json-render/react";
import type { CSSProperties } from "react";

import { previewCatalog } from "../../../src/preview/catalog.ts";
import { controlledStyle } from "./controlled-style.ts";

function framedWrapperStyle(
  style: NonNullable<ReturnType<typeof controlledStyle>>,
): CSSProperties {
  return {
    position: style.position,
    left: style.left,
    top: style.top,
    zIndex: style.zIndex,
    width: style.width,
    height: style.height,
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    whiteSpace: style.whiteSpace,
  };
}

function framedInputStyle(
  style: NonNullable<ReturnType<typeof controlledStyle>>,
): CSSProperties {
  const height =
    typeof style.height === "number"
      ? Math.max(style.height - 30, 40)
      : undefined;
  return {
    width: "100%",
    height,
    backgroundColor: style.backgroundColor,
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    whiteSpace: style.whiteSpace,
    borderRadius: style.borderRadius,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth,
    borderStyle: style.borderStyle,
    boxShadow: style.boxShadow,
  };
}

export const Button: ComponentFn<
  typeof previewCatalog,
  "Button"
> = ({ props, emit }) => {
  const style = controlledStyle(props.style);
  const iconSize =
    typeof props.style?.height === "number"
      ? Math.min(42, Math.max(18, Math.round(props.style.height * 0.62)))
      : undefined;
  const iconStyle = iconSize
    ? { width: iconSize, height: iconSize, flexBasis: iconSize }
    : undefined;
  return (
    <button
      className={`ui-button ui-button-${props.variant}`}
      data-ui-node-id={props.nodeId}
      type="button"
      disabled={props.disabled}
      onClick={() => emit("press")}
      style={style}
    >
      {props.leadingIconSrc ? (
        <img
          className="ui-button-icon"
          src={props.leadingIconSrc}
          alt=""
          aria-hidden="true"
          style={iconStyle}
        />
      ) : null}
      <span>{props.label}</span>
      {props.trailingIconSrc ? (
        <img
          className="ui-button-icon"
          src={props.trailingIconSrc}
          alt=""
          aria-hidden="true"
          style={iconStyle}
        />
      ) : null}
    </button>
  );
};

export const Input: ComponentFn<typeof previewCatalog, "Input"> = ({
  props,
  bindings,
}) => {
  const [value, setValue] = useBoundProp(
    props.value,
    bindings?.value,
  );
  const inputValue = typeof value === "string" ? value : "";
  const style = controlledStyle(props.style);
  const hideLabel = props.hideLabel === true;
  const framedInput = props.style?.position === "absolute";
  const hasFramedLabelSpace =
    typeof props.style?.height !== "number" || props.style.height >= 70;
  if (
    framedInput &&
    !hideLabel &&
    props.label.trim() &&
    hasFramedLabelSpace
  ) {
    return (
      <label
        className={`ui-field-framed${
          props.disabled ? " is-disabled" : ""
        }`}
        data-ui-node-id={props.nodeId}
        style={style ? framedWrapperStyle(style) : undefined}
      >
        <span>{props.label}</span>
        <input
          type={props.inputType}
          value={inputValue}
          placeholder={props.placeholder ?? ""}
          disabled={props.disabled}
          onChange={(event) => setValue(event.target.value)}
          style={style ? framedInputStyle(style) : undefined}
        />
      </label>
    );
  }
  if (framedInput || hideLabel) {
    return (
      <input
        className={`ui-input-direct${
          props.disabled ? " is-disabled" : ""
        }`}
        data-ui-node-id={props.nodeId}
        type={props.inputType}
        aria-label={
          props.label.trim() || props.placeholder || props.nodeId
        }
        value={inputValue}
        placeholder={props.placeholder ?? ""}
        disabled={props.disabled}
        onChange={(event) => setValue(event.target.value)}
        style={style}
      />
    );
  }
  return (
    <label
      className={`ui-field${props.disabled ? " is-disabled" : ""}`}
      data-ui-node-id={props.nodeId}
      style={style}
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

export const Link: ComponentFn<typeof previewCatalog, "Link"> = ({
  props,
  emit,
}) => {
  const className = `ui-link${props.disabled ? " is-disabled" : ""}`;
  if (props.disabled) {
    return (
      <span
        className={className}
        data-ui-node-id={props.nodeId}
        role="link"
        aria-disabled="true"
        style={controlledStyle(props.style)}
      >
        {props.label}
      </span>
    );
  }
  return (
    <a
      className={className}
      data-ui-node-id={props.nodeId}
      href="#"
      role="link"
      onClick={(event) => {
        event.preventDefault();
        emit("press");
      }}
      style={controlledStyle(props.style)}
    >
      {props.label}
    </a>
  );
};

export const Radio: ComponentFn<typeof previewCatalog, "Radio"> = ({
  props,
}) => {
  const store = useStateStore();
  const currentValue = useStateValue<string>(`/${props.stateKey}`);
  const checked = currentValue === props.value;
  return (
    <label
      className={`ui-radio${props.disabled ? " is-disabled" : ""}`}
      data-ui-node-id={props.nodeId}
      style={controlledStyle(props.style)}
    >
      <input
        type="radio"
        name={props.stateKey}
        value={props.value}
        checked={checked}
        disabled={props.disabled}
        onChange={() => store.set(`/${props.stateKey}`, props.value)}
      />
      <span>{props.label}</span>
    </label>
  );
};

export const Switch: ComponentFn<typeof previewCatalog, "Switch"> = ({
  props,
  bindings,
}) => {
  const [checked, setChecked] = useBoundProp(
    props.checked,
    bindings?.checked,
  );
  const inputChecked = typeof checked === "boolean" ? checked : false;
  return (
    <label
      className={`ui-switch${props.disabled ? " is-disabled" : ""}`}
      data-ui-node-id={props.nodeId}
      style={controlledStyle(props.style)}
    >
      <input
        type="checkbox"
        role="switch"
        checked={inputChecked}
        disabled={props.disabled}
        onChange={(event) => setChecked(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
};

export const Select: ComponentFn<typeof previewCatalog, "Select"> = ({
  props,
  bindings,
}) => {
  const [value, setValue] = useBoundProp(
    props.value,
    bindings?.value,
  );
  const selectValue = typeof value === "string" ? value : "";
  return (
    <label
      className={`ui-field ui-select${
        props.disabled ? " is-disabled" : ""
      }`}
      data-ui-node-id={props.nodeId}
      style={controlledStyle(props.style)}
    >
      <span>{props.label}</span>
      <select
        value={selectValue}
        disabled={props.disabled}
        onChange={(event) => setValue(event.target.value)}
      >
        {props.placeholder ? (
          <option value="" disabled>
            {props.placeholder}
          </option>
        ) : null}
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
};

export const Textarea: ComponentFn<typeof previewCatalog, "Textarea"> = ({
  props,
  bindings,
}) => {
  const [value, setValue] = useBoundProp(
    props.value,
    bindings?.value,
  );
  const textValue = typeof value === "string" ? value : "";
  return (
    <label
      className={`ui-field ui-textarea${
        props.disabled ? " is-disabled" : ""
      }`}
      data-ui-node-id={props.nodeId}
      style={controlledStyle(props.style)}
    >
      <span>{props.label}</span>
      <textarea
        value={textValue}
        placeholder={props.placeholder ?? ""}
        disabled={props.disabled}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>
  );
};

export const FormField: ComponentFn<typeof previewCatalog, "FormField"> = ({
  props,
  children,
}) => {
  const style = controlledStyle(props.style);
  const absoluteField = props.style?.position === "absolute";
  return (
    <fieldset
      className={`ui-form-field${
        props.errorText ? " has-error" : ""
      }${props.required ? " is-required" : ""}${
        absoluteField ? " ui-form-field-absolute" : ""
      }`}
      data-ui-node-id={props.nodeId}
      style={style}
    >
      <legend>{props.label}</legend>
      {props.helpText ? (
        <span className="ui-form-field-help">{props.helpText}</span>
      ) : null}
      {props.errorText ? (
        <span className="ui-form-field-error">{props.errorText}</span>
      ) : null}
      <div className="ui-form-field-controls">{children}</div>
    </fieldset>
  );
};
