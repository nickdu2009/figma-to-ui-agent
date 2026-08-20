/**
 * 发布面板（S13，owner）：草稿列表/发布、发布历史、受控前序回滚。
 * 迁移计划只能在生成阶段封存到 Candidate/Draft；浏览器绝不提交计划 JSON。
 * UI 隐藏无权限操作，但授权事实永远以服务端响应为准。
 */
import { useCallback, useEffect, useState } from "react";
import { notifyReleaseChanged } from "./published-preview-loader.tsx";

interface DraftItem {
  id: string;
  generationRunId: string;
  status: string;
  createdAt: string;
}

interface VersionItem {
  id: string;
  draftVersionId: string;
  publishedAt: string;
}

export function ReleasePanel(props: { appId: string }) {
  const { appId } = props;
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [draftsRes, versionsRes, currentRes] = await Promise.all([
      fetch(`/api/apps/${appId}/drafts`, { credentials: "include" }),
      fetch(`/api/apps/${appId}/releases/published`, {
        credentials: "include",
      }),
      fetch(`/api/apps/${appId}/releases/current`, { credentials: "include" }),
    ]);
    if (draftsRes.ok) {
      setDrafts(((await draftsRes.json()) as { drafts: DraftItem[] }).drafts);
    }
    if (versionsRes.ok) {
      setVersions(
        ((await versionsRes.json()) as { versions: VersionItem[] }).versions,
      );
    }
    if (currentRes.ok) {
      const body = (await currentRes.json()) as {
        current: { publishedVersionId: string } | null;
      };
      setCurrentId(body.current?.publishedVersionId ?? null);
    }
  }, [appId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const publish = async (draftId: string) => {
    setError(null);
    const res = await fetch(`/api/apps/${appId}/releases/publish`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId, protocolVersion: 2 }),
    });
    if (res.ok) {
      await reload();
      notifyReleaseChanged();
      return;
    }
    const body = (await res.json()) as { error?: { code?: string } };
    setError(body.error?.code ?? `发布失败：${res.status}`);
  };

  const rollback = async (publishedVersionId: string) => {
    setError(null);
    const res = await fetch(`/api/apps/${appId}/releases/rollback`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishedVersionId, protocolVersion: 2 }),
    });
    if (res.ok) {
      await reload();
      notifyReleaseChanged();
      return;
    }
    const body = (await res.json()) as { error?: { code?: string } };
    setError(body.error?.code ?? `回滚失败：${res.status}`);
  };

  return (
    <section data-testid="release-panel" className="workbench-panel">
      <h3>草稿</h3>
      {drafts.length === 0 && <p data-testid="drafts-empty">暂无草稿</p>}
      <ul>
        {drafts.map((draft) => (
          <li key={draft.id} data-testid={`draft-${draft.id}`}>
            <code>{draft.id.slice(0, 8)}</code> {draft.status}{" "}
            <button
              type="button"
              data-testid={`publish-${draft.id}`}
              onClick={() => void publish(draft.id)}
            >
              发布
            </button>
          </li>
        ))}
      </ul>
      <h3>发布历史</h3>
      {versions.length === 0 && <p data-testid="versions-empty">暂无发布</p>}
      <ul>
        {versions.map((version) => (
          <li key={version.id} data-testid={`version-${version.id}`}>
            <code>{version.id.slice(0, 8)}</code>{" "}
            {version.id === currentId ? "（当前）" : null}
            {version.id !== currentId && (
              <button
                type="button"
                data-testid={`rollback-${version.id}`}
                onClick={() => void rollback(version.id)}
              >
                回滚
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p data-testid="release-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
