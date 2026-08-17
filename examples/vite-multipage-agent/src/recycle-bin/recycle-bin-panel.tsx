/**
 * 回收站面板（S6，owner）：已删除记录列表/恢复；应用删除入口。
 * 管理员治理（应用恢复）在平台治理端点，UI 仅对 isAdmin 用户显示。
 */
import { useCallback, useEffect, useState } from "react";
import { notifyReleaseChanged } from "../release/published-preview-loader.tsx";

interface BinItem {
  id: string;
  itemType: string;
  recordId: string;
  collectionKey: string | null;
  deletedAt: string;
  expiresAt: string;
}

export function RecycleBinPanel(props: {
  appId: string;
  onAppDeleted: () => void;
}) {
  const { appId, onAppDeleted } = props;
  const [items, setItems] = useState<BinItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/apps/${appId}/recycle-bin`, {
      credentials: "include",
    });
    if (res.ok) {
      setItems(((await res.json()) as { items: BinItem[] }).items);
      setError(null);
    } else {
      setError(`加载回收站失败：${res.status}`);
    }
  }, [appId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const restore = async (itemId: string) => {
    setError(null);
    const res = await fetch(
      `/api/apps/${appId}/recycle-bin/${itemId}/restore`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (res.ok) {
      await reload();
      notifyReleaseChanged();
      return;
    }
    const body = (await res.json()) as { error?: { code?: string } };
    setError(body.error?.code ?? `恢复失败：${res.status}`);
  };

  const deleteApp = async () => {
    const res = await fetch(`/api/apps/${appId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      onAppDeleted();
      return;
    }
    setError(`删除应用失败：${res.status}`);
  };

  return (
    <section data-testid="recycle-bin-panel" className="workbench-panel">
      <h3>回收站（30 天保留）</h3>
      {items.length === 0 && <p data-testid="bin-empty">回收站为空</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id} data-testid={`bin-item-${item.id}`}>
            <code>{item.collectionKey}</code> /{" "}
            <code>{item.recordId.slice(0, 8)}</code> 过期{" "}
            {new Date(item.expiresAt).toLocaleDateString()}{" "}
            <button
              type="button"
              data-testid={`restore-${item.id}`}
              onClick={() => void restore(item.id)}
            >
              恢复
            </button>
          </li>
        ))}
      </ul>
      <h3>危险区</h3>
      {confirmingDelete ? (
        <div data-testid="app-delete-confirm">
          <p>应用将进入回收站 30 天，期间所有正常路由关闭。确认？</p>
          <button
            type="button"
            data-testid="app-delete-confirm-yes"
            onClick={() => void deleteApp()}
          >
            确认删除
          </button>
          <button
            type="button"
            data-testid="app-delete-confirm-no"
            onClick={() => setConfirmingDelete(false)}
          >
            取消
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="app-delete-open"
          onClick={() => setConfirmingDelete(true)}
        >
          删除应用…
        </button>
      )}
      {error && (
        <p data-testid="bin-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
