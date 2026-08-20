/**
 * 数据展示组件（设计 §7.3，计划 S5）：
 * - DataTable：只渲染 state 查询结果 + 发出 requestData/rowAction 意图；
 *   不 fetch、不拼 URL（生命周期接线属 S6/S9 的受控 LifecycleDispatcher）；
 * - Collection/CollectionItem：item 模板经 repeat 渲染；
 * - DescriptionList：typed items 键值展示。
 */
import type { ReactNode } from "react";
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

export interface TypedColumn {
  key: string;
  label: string;
  cell:
    | "text"
    | "number"
    | "date"
    | "badge"
    | "avatar"
    | "link"
    | "boolean"
    | "actions";
  align?: "left" | "center" | "right";
  width?: number | string;
  sortable?: boolean;
  filter?: boolean;
}

interface DataTableQueryResult {
  rows?: Record<string, unknown>[];
  loading?: boolean;
  error?: { code?: string; message?: string } | string | null;
  nextCursor?: string | null;
}

function readQueryResult(raw: unknown): DataTableQueryResult {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const candidate = raw as {
      rows?: unknown;
      loading?: unknown;
      error?: unknown;
      nextCursor?: unknown;
    };
    return {
      rows: Array.isArray(candidate.rows)
        ? (candidate.rows as Record<string, unknown>[])
        : [],
      loading: candidate.loading === true,
      error: (candidate.error as DataTableQueryResult["error"]) ?? null,
      nextCursor:
        typeof candidate.nextCursor === "string" ? candidate.nextCursor : null,
    };
  }
  if (Array.isArray(raw)) {
    return {
      rows: raw as Record<string, unknown>[],
      loading: false,
      error: null,
      nextCursor: null,
    };
  }
  return { rows: [], loading: false, error: null, nextCursor: null };
}

function renderCell(column: TypedColumn, value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return <span className="vma-cell-empty">—</span>;
  }
  switch (column.cell) {
    case "badge":
      return <span className="vma-badge">{String(value)}</span>;
    case "boolean":
      return (
        <span
          className="vma-cell-boolean"
          aria-label={value ? catalogMessage("boolean.true") : catalogMessage("boolean.false")}
        >
          {IconGlyph({
            name: value ? "check" : "x",
            size: 14,
            decorative: true,
          })}
        </span>
      );
    case "date":
      return <span>{String(value)}</span>;
    case "number":
      return <span className="vma-cell-number">{String(value)}</span>;
    case "link":
      return <a href={String(value)}>{String(value)}</a>;
    default:
      return <span>{String(value)}</span>;
  }
}

export function DataTable({
  props,
  on,
}: BaseProps<{
  columns: TypedColumn[];
  queryKey: string;
  selectable?: boolean;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}>) {
  const columns = props.columns ?? [];
  const [result] = useStateBinding<DataTableQueryResult>(
    `/runtime/queries/${props.queryKey}`,
  );
  const query = readQueryResult(result);
  const rows = query.rows ?? [];
  const loading = query.loading === true;
  const error = query.error ?? null;

  if (loading && rows.length === 0) {
    return (
      <div
        className="vma-datatable vma-datatable--loading"
        data-vma-style-part="loading"
        role="status"
      >
        {IconGlyph({ name: "loader", decorative: true })}
        <span>{catalogMessage("common.loading")}</span>
      </div>
    );
  }
  if (error !== null) {
    const message =
      typeof error === "string" ? error : (error.message ?? catalogMessage("common.loadFailed"));
    return (
      <div className="vma-datatable vma-datatable--error" role="alert">
        <p>{message}</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        className="vma-datatable vma-datatable--empty"
        data-vma-style-part="empty"
      >
        <p className="vma-datatable-empty-title">
          {props.emptyTitle ?? catalogMessage("common.emptyTitle")}
        </p>
        {props.emptyDescription ? <p>{props.emptyDescription}</p> : null}
      </div>
    );
  }
  return (
    <div className="vma-datatable" data-vma-style-part="root">
      <table className="vma-table" data-vma-style-part="root">
        <thead data-vma-style-part="header">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                data-vma-style-part="header"
                style={{
                  textAlign: column.align ?? "left",
                  width: column.width,
                }}
                aria-sort={column.sortable ? "none" : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} data-vma-style-part="row">
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-vma-style-part="cell"
                  style={{ textAlign: column.align ?? "left" }}
                >
                  {renderCell(column, row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {loading ? (
        <div
          className="vma-datatable-refreshing"
          role="status"
          aria-live="polite"
        >
          {catalogMessage("common.refreshing")}
        </div>
      ) : null}
      <span
        className="vma-datatable-request-hint"
        data-vma-querykey={props.queryKey}
        hidden
      >
        {on("requestData").bound ? "bound" : "unbound"}
      </span>
    </div>
  );
}

/* ---------------- Collection / CollectionItem ---------------- */

export function Collection({
  props,
  children,
}: BaseProps<{
  queryKey: string;
  emptyTitle?: string;
  emptyDescription?: string;
}>) {
  const [result] = useStateBinding<unknown>(
    `/runtime/queries/${props.queryKey}`,
  );
  const rows = Array.isArray(result) ? result : [];
  const loading =
    !Array.isArray(result) &&
    result !== null &&
    typeof result === "object" &&
    (result as { loading?: unknown }).loading === true;

  if (loading) {
    return (
      <div
        className="vma-collection vma-collection--loading"
        data-vma-style-part="loading"
        role="status"
      >
        {IconGlyph({ name: "loader", decorative: true })}
        <span>{catalogMessage("common.loading")}</span>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        className="vma-collection vma-collection--empty"
        data-vma-style-part="empty"
      >
        <p className="vma-collection-empty-title">
          {props.emptyTitle ?? catalogMessage("common.emptyTitle")}
        </p>
        {props.emptyDescription ? <p>{props.emptyDescription}</p> : null}
      </div>
    );
  }
  return (
    <div className="vma-collection" data-vma-style-part="root">
      {rows.map((_, index) => (
        <CollectionSlot
          key={index}
          index={index}
          basePath={`/runtime/queries/${props.queryKey}/${index}`}
        >
          {children}
        </CollectionSlot>
      ))}
    </div>
  );
}

import { RepeatScopeProvider } from "@json-render/react";

function CollectionSlot(props: {
  index: number;
  basePath: string;
  children: ReactNode;
}) {
  return (
    <RepeatScopeProvider
      item={null}
      index={props.index}
      basePath={props.basePath}
    >
      {props.children}
    </RepeatScopeProvider>
  );
}

export function CollectionItem({ children }: BaseProps<Record<string, never>>) {
  return (
    <div className="vma-collection-item" data-vma-style-part="root">
      {children}
    </div>
  );
}

/* ---------------- DescriptionList ---------------- */

export interface DescriptionListItem {
  term: string;
  description?: string;
  format?: "text" | "number" | "date" | "badge";
}

export function DescriptionList({
  props,
}: BaseProps<{ items: DescriptionListItem[]; emptyText?: string }>) {
  const items = props.items ?? [];
  if (items.length === 0) {
    return (
      <div className="vma-description-list vma-description-list--empty">
        <p>{props.emptyText ?? catalogMessage("common.emptyInfo")}</p>
      </div>
    );
  }
  return (
    <dl className="vma-description-list" data-vma-style-part="root">
      {items.map((item) => (
        <div className="vma-description-list-row" key={item.term}>
          <dt data-vma-style-part="term">{item.term}</dt>
          <dd data-vma-style-part="description">
            {item.description === undefined || item.description === "" ? (
              <span className="vma-cell-empty">—</span>
            ) : item.format === "badge" ? (
              <span className="vma-badge">{item.description}</span>
            ) : (
              item.description
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
