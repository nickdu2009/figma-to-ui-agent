/**
 * 完整表单组件（设计 §7.5，计划 S5）：
 * - Form：值固定写 /runtime/forms/<formId>（values/dirty/epoch）；
 *   P0 不接受模型 defaultValues；确定性空值（字段缺省为确定值）；
 *   hydration epoch + dirty CAS（只在本 epoch 内标脏）；
 * - DatePicker/DateRangePicker：ISO YYYY-MM-DD 受控值；
 * - Combobox/MultiSelect：typed options 受控过滤/多选。
 */
import { useId, useMemo, useState, type ReactNode } from "react";
import { useStateBinding } from "@json-render/react";

import { IconGlyph } from "./icons.tsx";
import { catalogMessage } from "./messages.ts";

type BaseProps<P> = {
  props: P;
  children?: ReactNode;
  on: (event: string) => {
    emit: () => void;
    shouldPreventDefault: boolean;
    bound: boolean;
  };
};

/* ---------------- Form ---------------- */

export interface FormValuesState {
  values?: Record<string, unknown>;
  dirty?: boolean;
  epoch?: number;
  abandoned?: boolean;
}

export function Form({
  props,
  children,
  on,
}: BaseProps<{
  formId: string;
  schemaRef: string;
  submitLabel?: string;
  resetLabel?: string;
  disabled?: boolean;
}>) {
  const base = `/runtime/forms/${props.formId}`;
  const [state, setState] = useStateBinding<FormValuesState>(base);
  const epoch = useMemo(() => state?.epoch ?? 0, [state?.epoch]);
  // hydration epoch：挂载即推进（确定性空值 —— values 缺省 {}）
  const hydrated = useMemo(() => ({ epoch: epoch + 1 }), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (state?.epoch === undefined) {
    setState({ values: {}, dirty: false, epoch: hydrated.epoch });
  }
  const disabled = props.disabled === true;

  const markDirty = () => {
    // dirty CAS：只有当前 epoch 才允许标脏（陈旧闭包写入被拒绝）
    if ((state?.epoch ?? 0) >= hydrated.epoch) {
      setState({
        ...(state ?? { values: {} }),
        dirty: true,
        epoch: state?.epoch ?? hydrated.epoch,
      });
    }
  };
  // 把 markDirty 提供给字段（经 context）
  const ctxValue = useMemo(
    () => ({
      formId: props.formId,
      values: state?.values ?? {},
      disabled,
      markDirty,
    }),
    [props.formId, state?.values, disabled, state?.epoch], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <FormFieldsContext.Provider value={ctxValue}>
      <form
        className="vma-form"
        data-vma-style-part="root"
        data-vma-form-id={props.formId}
        data-vma-schema-ref={props.schemaRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) on("submit").emit();
        }}
        onReset={() => {
          setState({ values: {}, dirty: false, epoch: hydrated.epoch });
          on("reset").emit();
        }}
      >
        {children}
        <div className="vma-form-actions" data-vma-style-part="actions">
          <button type="submit" className="vma-form-submit" disabled={disabled}>
            {props.submitLabel ?? catalogMessage("form.submit")}
          </button>
          <button type="reset" className="vma-form-reset" disabled={disabled}>
            {props.resetLabel ?? catalogMessage("form.reset")}
          </button>
        </div>
      </form>
    </FormFieldsContext.Provider>
  );
}

import { createContext, useContext } from "react";

interface FormFieldsContextValue {
  formId: string;
  values: Record<string, unknown>;
  disabled: boolean;
  markDirty: () => void;
}

const FormFieldsContext = createContext<FormFieldsContextValue | null>(null);

function useFormField(name: string): {
  value: unknown;
  setValue: (value: unknown) => void;
  disabled: boolean;
} {
  const ctx = useContext(FormFieldsContext);
  const [, setFormState] = useStateBinding<FormValuesState>(
    `/runtime/forms/${ctx?.formId ?? "__orphan__"}`,
  );
  return {
    value: ctx?.values[name],
    setValue: (value) => {
      if (!ctx || ctx.disabled) return;
      const current = ctx.values;
      setFormState({
        values: { ...current, [name]: value },
        dirty: true,
        epoch: undefined,
      } as FormValuesState);
      ctx.markDirty();
    },
    disabled: ctx?.disabled ?? true,
  };
}

export function FormSection({
  props,
  children,
}: BaseProps<{ title: string; description?: string }>) {
  return (
    <fieldset className="vma-form-section" data-vma-style-part="root">
      <legend className="vma-form-section-title" data-vma-style-part="title">
        {props.title}
      </legend>
      {props.description ? (
        <p
          className="vma-form-section-description"
          data-vma-style-part="description"
        >
          {props.description}
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}

export function FormSectionContent({
  children,
}: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-form-section-content" data-vma-style-part="root">
      {children}
    </div>
  );
}

/* ---------------- DatePicker ---------------- */

export function DatePicker({
  props,
  on,
}: BaseProps<{
  name: string;
  label?: string;
  value?: string;
  min?: string;
  max?: string;
  disabledDates?: string[];
  locale?: string;
  disabled?: boolean;
}>) {
  const field = useFormField(props.name);
  const value = typeof field.value === "string" ? field.value : props.value;
  const disabled = props.disabled === true || field.disabled;
  const disabledSet = useMemo(
    () => new Set(props.disabledDates ?? []),
    [props.disabledDates],
  );
  return (
    <label className="vma-date-picker" data-vma-style-part="root">
      {props.label ? (
        <span className="vma-field-label">{props.label}</span>
      ) : null}
      <input
        type="date"
        className="vma-date-input"
        data-vma-style-part="input"
        value={value ?? ""}
        min={props.min}
        max={props.max}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          if (disabledSet.has(next)) return;
          field.setValue(next);
          on("change").emit();
        }}
      />
    </label>
  );
}

/* ---------------- DateRangePicker ---------------- */

export function DateRangePicker({
  props,
  on,
}: BaseProps<{
  name: string;
  label?: string;
  value?: { from: string; to: string };
  min?: string;
  max?: string;
  locale?: string;
  disabled?: boolean;
}>) {
  const field = useFormField(props.name);
  const raw = field.value ?? props.value;
  const from =
    raw && typeof raw === "object"
      ? String((raw as { from?: unknown }).from ?? "")
      : "";
  const to =
    raw && typeof raw === "object"
      ? String((raw as { to?: unknown }).to ?? "")
      : "";
  const disabled = props.disabled === true || field.disabled;
  const rangeError =
    from !== "" && to !== "" && from > to ? catalogMessage("form.dateRangeInvalid") : null;
  return (
    <div className="vma-date-range-picker" data-vma-style-part="root">
      {props.label ? (
        <span className="vma-field-label">{props.label}</span>
      ) : null}
      <div className="vma-date-range-inputs">
        <input
          type="date"
          className="vma-date-input"
          data-vma-style-part="input"
          aria-label={props.label ? `${props.label} ${catalogMessage("form.dateFrom")}` : catalogMessage("form.dateFrom")}
          value={from}
          min={props.min}
          max={props.max}
          disabled={disabled}
          onChange={(event) => {
            field.setValue({ from: event.target.value, to });
            on("change").emit();
          }}
        />
        <span aria-hidden="true">–</span>
        <input
          type="date"
          className="vma-date-input"
          data-vma-style-part="input"
          aria-label={props.label ? `${props.label} ${catalogMessage("form.dateTo")}` : catalogMessage("form.dateTo")}
          value={to}
          min={props.min}
          max={props.max}
          disabled={disabled}
          onChange={(event) => {
            field.setValue({ from, to: event.target.value });
            on("change").emit();
          }}
        />
      </div>
      {rangeError ? (
        <span className="vma-field-error" role="alert">
          {rangeError}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------- Combobox ---------------- */

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

export function Combobox({
  props,
  on,
}: BaseProps<{
  name: string;
  label?: string;
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  loading?: boolean;
  emptyText?: string;
  disabled?: boolean;
}>) {
  const field = useFormField(props.name);
  const value = typeof field.value === "string" ? field.value : props.value;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const listboxId = useId();
  const disabled = props.disabled === true || field.disabled;
  const options = props.options ?? [];
  const filtered = useMemo(() => {
    if (filter === "") return options;
    const needle = filter.toLowerCase();
    return options.filter((option) =>
      option.label.toLowerCase().includes(needle),
    );
  }, [options, filter]);
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <div className="vma-combobox" data-vma-style-part="root">
      {props.label ? (
        <span className="vma-field-label" id={`${listboxId}-label`}>
          {props.label}
        </span>
      ) : null}
      <div className="vma-combobox-control">
        <input
          type="text"
          className="vma-combobox-input"
          data-vma-style-part="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            selected ? `${listboxId}-${selected.value}` : undefined
          }
          placeholder={
            props.placeholder ?? (selected ? selected.label : catalogMessage("common.selectPlaceholder"))
          }
          value={open ? filter : selected ? selected.label : ""}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setFilter("");
          }}
          onChange={(event) => {
            setFilter(event.target.value);
            setOpen(true);
          }}
        />
        <span className="vma-combobox-chevron" aria-hidden="true">
          {IconGlyph({
            name: open ? "chevron-up" : "chevron-down",
            size: 14,
            decorative: true,
          })}
        </span>
        {open ? (
          <ul id={listboxId} role="listbox" className="vma-combobox-list">
            {props.loading ? (
              <li className="vma-combobox-loading" role="status">
                {catalogMessage("common.loading")}
              </li>
            ) : filtered.length === 0 ? (
              <li className="vma-combobox-empty">
                {props.emptyText ?? catalogMessage("common.noMatch")}
              </li>
            ) : (
              filtered.map((option) => (
                <li
                  key={option.value}
                  id={`${listboxId}-${option.value}`}
                  role="option"
                  aria-selected={option.value === value}
                  className={`vma-combobox-option${option.value === value ? " vma-combobox-option--selected" : ""}`}
                  data-vma-style-part="option"
                  aria-disabled={option.disabled ? true : undefined}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (option.disabled) return;
                    field.setValue(option.value);
                    on("change").emit();
                    setOpen(false);
                    setFilter("");
                  }}
                >
                  <span>{option.label}</span>
                  {option.description ? (
                    <span className="vma-combobox-option-description">
                      {option.description}
                    </span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- MultiSelect ---------------- */

export function MultiSelect({
  props,
  on,
}: BaseProps<{
  name: string;
  label?: string;
  options: SelectOption[];
  value?: string[];
  maxCount?: number;
  chips?: boolean;
  loading?: boolean;
  emptyText?: string;
  disabled?: boolean;
}>) {
  const field = useFormField(props.name);
  const rawValue = Array.isArray(field.value)
    ? (field.value as string[])
    : props.value;
  const selectedValues = rawValue ?? [];
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const disabled = props.disabled === true || field.disabled;
  const options = props.options ?? [];
  const atCapacity =
    props.maxCount !== undefined && selectedValues.length >= props.maxCount;
  const showChips = props.chips !== false;

  const toggle = (value: string) => {
    if (disabled) return;
    const next = selectedValues.includes(value)
      ? selectedValues.filter((entry) => entry !== value)
      : atCapacity
        ? selectedValues
        : [...selectedValues, value];
    if (next === selectedValues) return;
    field.setValue(next);
    on("change").emit();
  };

  return (
    <div className="vma-multi-select" data-vma-style-part="root">
      {props.label ? (
        <span className="vma-field-label">{props.label}</span>
      ) : null}
      <button
        type="button"
        className="vma-multi-select-control"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        disabled={disabled}
        data-vma-style-part="input"
        onClick={() => setOpen((value) => !value)}
      >
        {selectedValues.length === 0 ? (
          <span className="vma-multi-select-placeholder">
            {catalogMessage("common.selectPlaceholder")}
          </span>
        ) : showChips ? (
          <span className="vma-multi-select-chips">
            {selectedValues.map((value) => {
              const option = options.find((entry) => entry.value === value);
              return (
                <span
                  key={value}
                  className="vma-multi-select-chip"
                  data-vma-style-part="chip"
                >
                  {option ? option.label : value}
                  <span
                    className="vma-multi-select-chip-remove"
                    role="button"
                    tabIndex={0}
                    aria-label={catalogMessage("form.removeChip", {
                      label: option ? option.label : value,
                    })}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        toggle(value);
                      }
                    }}
                  >
                    {IconGlyph({ name: "x", size: 10, decorative: true })}
                  </span>
                </span>
              );
            })}
          </span>
        ) : (
          <span>
            {catalogMessage("multiselect.selectedCount", {
              count: selectedValues.length,
            })}
          </span>
        )}
        <span className="vma-multi-select-chevron" aria-hidden="true">
          {IconGlyph({
            name: open ? "chevron-up" : "chevron-down",
            size: 14,
            decorative: true,
          })}
        </span>
      </button>
      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          className="vma-multi-select-list"
        >
          {props.loading ? (
            <li className="vma-multi-select-loading" role="status">
              {catalogMessage("common.loading")}
            </li>
          ) : options.length === 0 ? (
            <li className="vma-multi-select-empty">
              {props.emptyText ?? catalogMessage("common.noOptions")}
            </li>
          ) : (
            options.map((option) => {
              const isSelected = selectedValues.includes(option.value);
              const optionDisabled =
                option.disabled || (!isSelected && atCapacity);
              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={optionDisabled ? true : undefined}
                  className={`vma-multi-select-option${isSelected ? " vma-multi-select-option--selected" : ""}`}
                  data-vma-style-part="option"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (optionDisabled) return;
                    toggle(option.value);
                  }}
                >
                  <span className="vma-multi-select-check" aria-hidden="true">
                    {isSelected
                      ? IconGlyph({ name: "check", size: 14, decorative: true })
                      : null}
                  </span>
                  <span>{option.label}</span>
                  {option.description ? (
                    <span className="vma-multi-select-option-description">
                      {option.description}
                    </span>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
