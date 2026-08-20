/**
 * 7 个白名单组件的升级绑定（设计 §8，计划 S5）：
 * - 严格复用 S1 overlay 合同（props widening 机械 union、children 只扩展）；
 * - 旧 v1 props（字符串列/字符串选项/items 数组）不经修改可渲染；
 * - typed/compound 新模式与旧模式并存（运行时按 props 形态分流）；
 * - 受控 open/index 状态：组件内部不形成第二状态事实（经 $bindState 可绑定）。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useBoundProp, useStateBinding } from "@json-render/react";

import { IconGlyph } from "./icons.tsx";
import { catalogMessage } from "./messages.ts";
import type { SelectOption } from "./forms.tsx";
import type { TypedColumn } from "./data-display.tsx";

type BaseProps<P> = {
  props: P;
  children?: ReactNode;
  on: (event: string) => {
    emit: () => void;
    shouldPreventDefault: boolean;
    bound: boolean;
  };
  bindings?: Record<string, string>;
};

/* ---------------- Table（§8.1） ---------------- */

interface TableLegacyProps {
  columns?: unknown;
  rows?: unknown;
  caption?: string | null;
  queryKey?: string;
  selectable?: boolean;
  loading?: boolean;
  emptyTitle?: string;
  errorTitle?: string;
}

function isTypedColumns(columns: unknown): columns is TypedColumn[] {
  return (
    Array.isArray(columns) &&
    columns.length > 0 &&
    typeof columns[0] === "object" &&
    columns[0] !== null &&
    "key" in columns[0]
  );
}

export function Table({ props, children }: BaseProps<TableLegacyProps>) {
  const columns = props.columns;
  // typed 模式：数据经 queryKey 从受控 state 读取
  const [queryResult] = useStateBinding<unknown>(
    props.queryKey
      ? `/runtime/queries/${props.queryKey}`
      : "/runtime/queries/__unused__",
  );
  if (isTypedColumns(columns)) {
    const rawRows = Array.isArray(queryResult)
      ? (queryResult as Record<string, unknown>[])
      : queryResult && typeof queryResult === "object"
        ? (((queryResult as { rows?: unknown }).rows as
            | Record<string, unknown>[]
            | undefined) ?? [])
        : [];
    if (props.loading === true && rawRows.length === 0) {
      return (
        <div className="vma-table-loading" role="status">
          {IconGlyph({ name: "loader", decorative: true })}
          <span>{catalogMessage("common.loading")}</span>
        </div>
      );
    }
    if (rawRows.length === 0) {
      return (
        <div className="vma-table-empty" data-vma-style-part="empty">
          <p>{props.emptyTitle ?? catalogMessage("common.emptyTitle")}</p>
        </div>
      );
    }
    return (
      <div className="vma-table-wrap" data-vma-style-part="root">
        <table className="vma-table">
          <thead data-vma-style-part="header">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={column.sortable ? "none" : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rawRows.map((row, index) => (
              <tr key={index} data-vma-style-part="row">
                {columns.map((column) => (
                  <td key={column.key} data-vma-style-part="cell">
                    {row[column.key] === undefined || row[column.key] === null
                      ? "—"
                      : String(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {children}
      </div>
    );
  }
  // legacy 简单模式（旧 v1 Spec 不经修改可渲染）
  const legacyColumns = Array.isArray(columns) ? (columns as string[]) : [];
  const legacyRows = Array.isArray(props.rows)
    ? (props.rows as unknown[][])
    : [];
  return (
    <figure className="vma-table-legacy">
      <table className="vma-table">
        {props.caption ? <caption>{props.caption}</caption> : null}
        <thead>
          <tr>
            {legacyColumns.map((column, index) => (
              <th key={index} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {legacyRows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {children}
    </figure>
  );
}

/* ---------------- Select（§8.2） ---------------- */

function toOptions(options: unknown): SelectOption[] {
  if (!Array.isArray(options)) return [];
  return options.map((option) =>
    typeof option === "string"
      ? { label: option, value: option }
      : (option as SelectOption),
  );
}

export function Select({
  props,
  on,
  bindings,
}: BaseProps<{
  label?: string;
  name?: string;
  options?: unknown;
  placeholder?: string | null;
  value?: string | null;
  disabled?: boolean;
}>) {
  const [boundValue, setBoundValue] = useBoundProp<string | null | undefined>(
    props.value ?? null,
    bindings?.value,
  );
  const [localValue, setLocalValue] = useState<string>(
    (props.value as string | null) ?? "",
  );
  const isBound = Boolean(bindings?.value);
  const value = isBound ? (boundValue ?? "") : localValue;
  const setValue = isBound ? setBoundValue : setLocalValue;
  const options = toOptions(props.options);
  const selectId = useMemo(
    () => `vma-select-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );
  return (
    <label className="vma-select" htmlFor={selectId}>
      {props.label ? (
        <span className="vma-field-label">{props.label}</span>
      ) : null}
      <select
        id={selectId}
        className="vma-select-control"
        value={value ?? ""}
        disabled={props.disabled === true}
        onChange={(event) => {
          setValue(event.target.value);
          on("change").emit();
        }}
      >
        {value === "" ? (
          <option value="">
            {props.placeholder ?? catalogMessage("common.selectPlaceholder")}
          </option>
        ) : null}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------------- Accordion（§8.3） ---------------- */

interface AccordionContextValue {
  openValues: string[];
  toggle: (value: string) => void;
  registerItem: (value: string) => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

export function Accordion({
  props,
  children,
}: BaseProps<{
  items?: { title: string; content: string }[];
  type?: "single" | "multiple" | null;
}>) {
  const [openValues, setOpenValues] = useState<string[]>([]);
  const multiple = props.type === "multiple";
  const toggle = useCallback(
    (value: string) => {
      setOpenValues((current) => {
        if (current.includes(value)) {
          return current.filter((entry) => entry !== value);
        }
        return multiple ? [...current, value] : [value];
      });
    },
    [multiple],
  );
  const ctx = useMemo<AccordionContextValue>(
    () => ({ openValues, toggle, registerItem: () => undefined }),
    [openValues, toggle],
  );
  const legacyItems = props.items ?? [];
  return (
    <AccordionContext.Provider value={ctx}>
      <div className="vma-accordion" data-vma-style-part="root">
        {legacyItems.map((item, index) => (
          <div
            className="vma-accordion-item vma-accordion-item--legacy"
            key={index}
          >
            <button
              type="button"
              className="vma-accordion-trigger"
              aria-expanded={openValues.includes(`item-${index}`)}
              onClick={() => toggle(`item-${index}`)}
            >
              {item.title}
              <span className="vma-accordion-chevron" aria-hidden="true">
                {IconGlyph({
                  name: "chevron-down",
                  size: 14,
                  decorative: true,
                })}
              </span>
            </button>
            {openValues.includes(`item-${index}`) ? (
              <div className="vma-accordion-content">{item.content}</div>
            ) : null}
          </div>
        ))}
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

function useAccordion(): AccordionContextValue {
  const ctx = useContext(AccordionContext);
  return (
    ctx ?? {
      openValues: [],
      toggle: () => undefined,
      registerItem: () => undefined,
    }
  );
}

export function AccordionItem({
  props,
  children,
}: BaseProps<{ value: string; defaultOpen?: boolean }>) {
  const { openValues, toggle } = useAccordion();
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false);
  const controlled = useContext(AccordionContext) !== null;
  const open = controlled ? openValues.includes(props.value) : localOpen;
  return (
    <div
      className={`vma-accordion-item${open ? " vma-accordion-item--open" : ""}`}
      data-vma-style-part="root"
      data-value={props.value}
    >
      <AccordionItemOpenContext.Provider
        value={{
          open,
          toggle: () =>
            controlled ? toggle(props.value) : setLocalOpen((value) => !value),
        }}
      >
        {children}
      </AccordionItemOpenContext.Provider>
    </div>
  );
}

const AccordionItemOpenContext = createContext<{
  open: boolean;
  toggle: () => void;
} | null>(null);

export function AccordionTrigger({
  children,
  on,
}: BaseProps<Record<string, never>>) {
  const ctx = useContext(AccordionItemOpenContext);
  const open = ctx?.open ?? false;
  return (
    <button
      type="button"
      className="vma-accordion-trigger"
      data-vma-style-part="root"
      aria-expanded={open}
      onClick={() => {
        ctx?.toggle();
        on("press").emit();
      }}
    >
      {children}
      <span className="vma-accordion-chevron" aria-hidden="true">
        {IconGlyph({ name: "chevron-down", size: 14, decorative: true })}
      </span>
    </button>
  );
}

export function AccordionContent({
  children,
}: BaseProps<Record<string, never>>) {
  const ctx = useContext(AccordionItemOpenContext);
  if (!(ctx?.open ?? false)) return null;
  return (
    <div className="vma-accordion-content" data-vma-style-part="root">
      {children}
    </div>
  );
}

/* ---------------- Popover（§8.3） ---------------- */

const PopoverContext = createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
} | null>(null);

export function Popover({
  props,
  children,
}: BaseProps<{ trigger?: string; content?: string }>) {
  const [open, setOpen] = useState(false);
  const ctx = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <PopoverContext.Provider value={ctx}>
      <span className="vma-popover" data-vma-style-part="root">
        {props.trigger === undefined ? null : (
          <button
            type="button"
            className="vma-popover-legacy-trigger"
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((value) => !value)}
          >
            {props.trigger}
          </button>
        )}
        {children}
        {open && props.content !== undefined ? (
          <span
            className="vma-popover-content vma-popover-content--legacy"
            role="dialog"
          >
            {props.content}
          </span>
        ) : null}
      </span>
    </PopoverContext.Provider>
  );
}

export function PopoverTrigger({ children }: BaseProps<Record<string, never>>) {
  const ctx = useContext(PopoverContext);
  const open = ctx?.open ?? false;
  return (
    <button
      type="button"
      className="vma-popover-trigger"
      data-vma-style-part="root"
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => ctx?.setOpen(!open)}
    >
      {children}
    </button>
  );
}

export function PopoverContent({
  props,
  children,
}: BaseProps<{
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}>) {
  const ctx = useContext(PopoverContext);
  if (!(ctx?.open ?? false)) return null;
  return (
    <span
      className={`vma-popover-content vma-popover-content--${props.side ?? "bottom"}-${props.align ?? "center"}`}
      data-vma-style-part="root"
      role="dialog"
    >
      {children}
    </span>
  );
}

/* ---------------- Carousel（§8.3） ---------------- */

const CarouselContext = createContext<{
  index: number;
  setIndex: (index: number) => void;
  count: number;
  register: () => number;
} | null>(null);

export function Carousel({
  props,
  children,
}: BaseProps<{
  items?: { title?: string | null; description?: string | null }[] | null;
}>) {
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const register = useCallback(() => {
    const next = count + 1;
    setCount(next);
    return next - 1;
  }, [count]);
  const ctx = useMemo(
    () => ({ index, setIndex, count, register }),
    [index, count, register],
  );
  const legacyItems = props.items ?? [];
  return (
    <CarouselContext.Provider value={ctx}>
      <div
        className="vma-carousel"
        data-vma-style-part="root"
        role="region"
        aria-roledescription={catalogMessage("carousel.region")}
      >
        <div className="vma-carousel-track">
          {legacyItems.map((item, itemIndex) => (
            <div
              className={`vma-carousel-item${itemIndex === index ? " vma-carousel-item--active" : ""}`}
              key={itemIndex}
              aria-hidden={itemIndex === index ? undefined : true}
            >
              {item.title ? <h3>{item.title}</h3> : null}
              {item.description ? <p>{item.description}</p> : null}
            </div>
          ))}
          {children}
        </div>
        <CarouselNav
          index={index}
          count={Math.max(count, legacyItems.length)}
          setIndex={setIndex}
        />
      </div>
    </CarouselContext.Provider>
  );
}

function CarouselNav(props: {
  index: number;
  count: number;
  setIndex: (i: number) => void;
}) {
  if (props.count <= 1) return null;
  return (
    <div className="vma-carousel-dots" role="tablist" aria-label={catalogMessage("carousel.positionLabel")}>
      {Array.from({ length: props.count }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={i === props.index}
          aria-label={catalogMessage("carousel.position", { index: i + 1 })}
          className={`vma-carousel-dot${i === props.index ? " vma-carousel-dot--active" : ""}`}
          onClick={() => props.setIndex(i)}
        />
      ))}
    </div>
  );
}

export function CarouselItem({ children }: BaseProps<Record<string, never>>) {
  const ctx = useContext(CarouselContext);
  const [slot] = useState(() => ctx?.register() ?? 0);
  const active = ctx ? ctx.index === slot : true;
  return (
    <div
      className={`vma-carousel-item${active ? " vma-carousel-item--active" : ""}`}
      data-vma-style-part="root"
      aria-hidden={active ? undefined : true}
    >
      {children}
    </div>
  );
}

export function CarouselControls({
  props,
}: BaseProps<{ prevLabel?: string; nextLabel?: string }>) {
  const ctx = useContext(CarouselContext);
  if (!ctx || ctx.count <= 1) return null;
  return (
    <div className="vma-carousel-controls" data-vma-style-part="root">
      <button
        type="button"
        className="vma-carousel-prev"
        data-vma-style-part="prev"
        aria-label={props.prevLabel ?? catalogMessage("carousel.prev")}
        disabled={ctx.index <= 0}
        onClick={() => ctx.setIndex(Math.max(0, ctx.index - 1))}
      >
        {IconGlyph({ name: "chevron-left", size: 16, decorative: true })}
      </button>
      <button
        type="button"
        className="vma-carousel-next"
        data-vma-style-part="next"
        aria-label={props.nextLabel ?? catalogMessage("carousel.next")}
        disabled={ctx.index >= ctx.count - 1}
        onClick={() => ctx.setIndex(Math.min(ctx.count - 1, ctx.index + 1))}
      >
        {IconGlyph({ name: "chevron-right", size: 16, decorative: true })}
      </button>
    </div>
  );
}

/* ---------------- Button（§8.4） ---------------- */

export function Button({
  props,
  on,
}: BaseProps<{
  label?: string;
  variant?: "secondary" | "primary" | "danger" | null;
  disabled?: boolean | null;
  size?: "sm" | "default" | "lg";
  icon?: string;
  iconPosition?: "left" | "right";
  loading?: boolean;
  type?: "button" | "submit" | "reset";
  fullWidth?: boolean;
}>) {
  const variant = props.variant ?? "primary";
  const size = props.size ?? "default";
  const loading = props.loading === true;
  const disabled = props.disabled === true || loading;
  const iconBefore =
    props.icon && props.iconPosition !== "right" ? props.icon : null;
  const iconAfter =
    props.icon && props.iconPosition === "right" ? props.icon : null;
  const classes = [
    "vma-button",
    `vma-button--${variant}`,
    `vma-button--${size}`,
    loading ? "vma-button--loading" : "",
    props.fullWidth ? "vma-button--full" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={props.type ?? "button"}
      className={classes}
      data-vma-style-part="root"
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-label={props.label /* loading 时保留可访问名称 */}
      onClick={() => {
        if (!disabled) on("press").emit();
      }}
    >
      {loading ? (
        <span className="vma-button-spinner" aria-hidden="true">
          {IconGlyph({ name: "loader", size: 14, decorative: true })}
        </span>
      ) : iconBefore ? (
        IconGlyph({ name: iconBefore, decorative: true })
      ) : null}
      <span className="vma-button-label">{props.label}</span>
      {iconAfter ? IconGlyph({ name: iconAfter, decorative: true }) : null}
    </button>
  );
}

/* ---------------- Image（§8.5） ---------------- */

export function Image({
  props,
}: BaseProps<{
  src?: string | null;
  alt?: string;
  width?: number | null;
  height?: number | null;
  objectFit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  objectPosition?: string;
  aspectRatio?: string;
  radius?: number | string;
  loading?: "lazy" | "eager";
  decorative?: boolean;
  assetRef?: { assetId: string; contentHash: string };
}>) {
  const style = {
    width: props.width ?? undefined,
    height: props.height ?? undefined,
    objectFit: props.objectFit,
    objectPosition: props.objectPosition,
    aspectRatio: props.aspectRatio,
    borderRadius:
      typeof props.radius === "number" ? `${props.radius}px` : props.radius,
  };
  // 生产 Bundle 不允许任意远程 URL：src 为空时渲染占位（assetRef 解析属 S7）
  const resolved = props.src ?? null;
  return (
    <span
      className="vma-image"
      data-vma-style-part="root"
      data-asset-id={props.assetRef?.assetId}
    >
      {resolved ? (
        <img
          className="vma-image-el"
          src={resolved}
          alt={props.decorative === true ? "" : (props.alt ?? "")}
          width={props.width ?? undefined}
          height={props.height ?? undefined}
          loading={props.loading ?? "lazy"}
          style={style}
          aria-hidden={props.decorative === true ? true : undefined}
        />
      ) : (
        <span
          className="vma-image-placeholder"
          style={style}
          aria-hidden="true"
        >
          {IconGlyph({ name: "file", size: 24, decorative: true })}
        </span>
      )}
    </span>
  );
}
