/**
 * 业务数据面板（S6）：集合浏览、固定查询分页、创建/编辑/删除/导出。
 * 字段可写性由发布 Schema 的 write 策略推导；UI 仅做展示层禁用，
 * 授权事实永远以服务端响应为准（403/400 照常呈现）。
 */
import { useCallback, useEffect, useState } from "react";
import { fetchCurrentRelease } from "../release/published-preview-loader.tsx";

interface SchemaField {
  key: string;
  type: "string" | "number" | "boolean" | "date" | "enum";
  required?: boolean;
  enumValues?: string[];
  read?: string[];
  write?: string[];
}

interface SchemaCollection {
  key: string;
  recordScope: string;
  fields: SchemaField[];
}

interface RecordItem {
  recordId: string;
  revision: number;
  data: Record<string, unknown>;
}

type Role = "owner" | "editor" | "viewer";

export function BusinessDataPanel(props: { appId: string; role: Role }) {
  const { appId, role } = props;
  const [collections, setCollections] = useState<SchemaCollection[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [items, setItems] = useState<RecordItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [conflict, setConflict] = useState<{
    record: RecordItem;
    currentRevision: number;
    current: RecordItem | null;
  } | null>(null);
  const [noSchema, setNoSchema] = useState(false);

  const active = collections.find((c) => c.key === activeKey) ?? null;

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentRelease(appId).then((current) => {
      if (cancelled) return;
      const schema = current?.businessSchema as
        | { collections?: SchemaCollection[] }
        | null
        | undefined;
      const cols = schema?.collections ?? [];
      setCollections(cols);
      setNoSchema(cols.length === 0);
      setActiveKey((prev) => prev ?? cols[0]?.key ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  const query = useCallback(
    async (cursor?: string) => {
      if (!activeKey) return;
      const res = await fetch(`/api/apps/${appId}/data/${activeKey}/query`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20, ...(cursor ? { cursor } : {}) }),
      });
      if (!res.ok) {
        setError(`查询失败：${res.status}`);
        return;
      }
      const body = (await res.json()) as {
        items: RecordItem[];
        nextCursor: string | null;
      };
      setItems((prev) => (cursor ? [...prev, ...body.items] : body.items));
      setNextCursor(body.nextCursor);
      setError(null);
    },
    [appId, activeKey],
  );

  useEffect(() => {
    void query();
  }, [query]);

  if (noSchema) {
    return (
      <section data-testid="data-panel" className="workbench-panel">
        <p data-testid="data-no-schema">当前发布版本没有业务数据 Schema</p>
      </section>
    );
  }

  const writable = (field: SchemaField): boolean =>
    (field.write ?? ["owner", "editor"]).includes(role);

  const saveRecord = async (
    recordId: string | null,
    revision: number | null,
    data: Record<string, unknown>,
  ) => {
    setError(null);
    const res = await fetch(
      recordId
        ? `/api/apps/${appId}/data/${activeKey}/${recordId}`
        : `/api/apps/${appId}/data/${activeKey}`,
      {
        method: recordId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          recordId ? { expectedRevision: revision, data } : { data },
        ),
      },
    );
    if (res.ok) {
      setEditing(null);
      setConflict(null);
      await query();
      return;
    }
    const body = (await res.json()) as {
      error?: {
        code?: string;
        currentRevision?: number;
        current?: RecordItem | null;
      };
    };
    if (body.error?.code === "revision_conflict" && recordId) {
      setConflict({
        record: { recordId, revision: revision ?? 0, data },
        currentRevision: body.error.currentRevision ?? 0,
        current: body.error.current ?? null,
      });
      return;
    }
    setError(body.error?.code ?? `保存失败：${res.status}`);
  };

  const removeRecord = async (record: RecordItem) => {
    setError(null);
    const res = await fetch(
      `/api/apps/${appId}/data/${activeKey}/${record.recordId}`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: record.revision }),
      },
    );
    if (res.ok) {
      await query();
      return;
    }
    const body = (await res.json()) as { error?: { code?: string } };
    setError(body.error?.code ?? `删除失败：${res.status}`);
  };

  const exportAll = async () => {
    const res = await fetch(`/api/apps/${appId}/data/${activeKey}/export`, {
      credentials: "include",
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: { code?: string } };
      setError(body.error?.code ?? `导出失败：${res.status}`);
      return;
    }
    const body = await res.json();
    const blob = new Blob([JSON.stringify(body, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeKey}-export.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section data-testid="data-panel" className="workbench-panel">
      <nav data-testid="collection-tabs">
        {collections.map((collection) => (
          <button
            key={collection.key}
            type="button"
            data-testid={`collection-tab-${collection.key}`}
            aria-pressed={collection.key === activeKey}
            onClick={() => {
              setActiveKey(collection.key);
              setItems([]);
              setNextCursor(null);
            }}
          >
            {collection.key}
          </button>
        ))}
      </nav>
      {active && (
        <>
          <div>
            {(role === "owner" || role === "editor") && (
              <button
                type="button"
                data-testid="record-create-open"
                onClick={() =>
                  setEditing({ recordId: "", revision: 0, data: {} })
                }
              >
                新建记录
              </button>
            )}
            {role === "owner" && (
              <button
                type="button"
                data-testid="record-export"
                onClick={() => void exportAll()}
              >
                导出 JSON
              </button>
            )}
          </div>
          <table data-testid="record-table">
            <thead>
              <tr>
                {active.fields.map((field) => (
                  <th key={field.key}>{field.key}</th>
                ))}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((record) => (
                <tr
                  key={record.recordId}
                  data-testid={`record-${record.recordId}`}
                >
                  {active.fields.map((field) => (
                    <td key={field.key} data-testid={`cell-${field.key}`}>
                      {record.data[field.key] === undefined
                        ? "—"
                        : String(record.data[field.key])}
                    </td>
                  ))}
                  <td>
                    {(role === "owner" || role === "editor") && (
                      <button
                        type="button"
                        data-testid={`edit-${record.recordId}`}
                        onClick={() => setEditing(record)}
                      >
                        编辑
                      </button>
                    )}
                    {role === "owner" && (
                      <button
                        type="button"
                        data-testid={`delete-${record.recordId}`}
                        onClick={() => void removeRecord(record)}
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <button
              type="button"
              data-testid="query-more"
              onClick={() => void query(nextCursor)}
            >
              加载更多
            </button>
          )}
          {editing && (
            <RecordEditor
              collection={active}
              record={editing.recordId ? editing : null}
              writable={writable}
              onCancel={() => setEditing(null)}
              onSave={(data) =>
                void saveRecord(
                  editing.recordId || null,
                  editing.recordId ? editing.revision : null,
                  data,
                )
              }
            />
          )}
          {conflict && (
            <div data-testid="revision-conflict" role="alertdialog">
              <p>
                保存冲突：记录已被他人修改（当前修订 {conflict.currentRevision}
                ）
              </p>
              <button
                type="button"
                data-testid="conflict-refresh"
                onClick={() => {
                  setConflict(null);
                  void query();
                }}
              >
                刷新查看最新
              </button>
              <button
                type="button"
                data-testid="conflict-discard"
                onClick={() => setConflict(null)}
              >
                放弃我的修改
              </button>
              <button
                type="button"
                data-testid="conflict-retry"
                onClick={() =>
                  void saveRecord(
                    conflict.record.recordId,
                    conflict.currentRevision,
                    conflict.record.data,
                  )
                }
              >
                基于最新值重试
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p data-testid="data-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function RecordEditor(props: {
  collection: SchemaCollection;
  record: RecordItem | null;
  writable: (field: SchemaField) => boolean;
  onCancel: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const { collection, record, writable, onCancel, onSave } = props;
  const [values, setValues] = useState<Record<string, unknown>>(
    record?.data ?? {},
  );
  return (
    <form
      data-testid="record-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values);
      }}
    >
      {collection.fields.map((field) => {
        const canWrite = writable(field);
        const value = values[field.key];
        return (
          <label key={field.key} data-testid={`field-${field.key}`}>
            {field.key}
            {field.type === "boolean" ? (
              <input
                type="checkbox"
                data-testid={`input-${field.key}`}
                disabled={!canWrite}
                checked={Boolean(value)}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [field.key]: e.target.checked }))
                }
              />
            ) : field.type === "enum" ? (
              <select
                data-testid={`input-${field.key}`}
                disabled={!canWrite}
                value={String(value ?? "")}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [field.key]: e.target.value }))
                }
              >
                <option value="">—</option>
                {(field.enumValues ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === "number" ? "number" : "text"}
                data-testid={`input-${field.key}`}
                disabled={!canWrite}
                value={value === undefined ? "" : String(value)}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [field.key]:
                      field.type === "number"
                        ? Number(e.target.value)
                        : e.target.value,
                  }))
                }
              />
            )}
          </label>
        );
      })}
      <button type="submit" data-testid="record-save">
        保存
      </button>
      <button type="button" data-testid="record-cancel" onClick={onCancel}>
        取消
      </button>
    </form>
  );
}
