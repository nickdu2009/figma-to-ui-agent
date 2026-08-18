/**
 * 发布面板（S6，owner）：草稿列表/发布（含迁移计划补充）、发布历史、回滚。
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
  const [migrationDraftId, setMigrationDraftId] = useState<string | null>(null);
  const [migrationPlanText, setMigrationPlanText] = useState("");
  const [reversePlanText, setReversePlanText] = useState("");

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

  const publish = async (
    draftId: string,
    migrationPlan?: unknown,
    reversePlan?: unknown,
  ) => {
    setError(null);
    const res = await fetch(`/api/apps/${appId}/releases/publish`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId, migrationPlan, reversePlan }),
    });
    if (res.ok) {
      setMigrationDraftId(null);
      setMigrationPlanText("");
      setReversePlanText("");
      await reload();
      notifyReleaseChanged();
      return;
    }
    const body = (await res.json()) as { error?: { code?: string } };
    if (body.error?.code === "migration_plan_required") {
      setMigrationDraftId(draftId);
      return;
    }
    setError(body.error?.code ?? `发布失败：${res.status}`);
  };

  const submitWithPlan = async () => {
    if (!migrationDraftId) return;
    try {
      const plan = migrationPlanText.trim()
        ? (JSON.parse(migrationPlanText) as unknown)
        : undefined;
      const reverse = reversePlanText.trim()
        ? (JSON.parse(reversePlanText) as unknown)
        : undefined;
      await publish(migrationDraftId, plan, reverse);
    } catch {
      setError("迁移计划 JSON 无法解析");
    }
  };

  const rollback = async (publishedVersionId: string) => {
    setError(null);
    const res = await fetch(`/api/apps/${appId}/releases/rollback`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishedVersionId }),
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
      {migrationDraftId && (
        <div data-testid="migration-plan-form">
          <h4>跨 Schema 发布需要迁移计划</h4>
          <textarea
            data-testid="migration-plan-input"
            placeholder='DataMigrationPlan JSON，例如 {"collections":[...]}'
            value={migrationPlanText}
            onChange={(e) => setMigrationPlanText(e.target.value)}
          />
          <textarea
            data-testid="reverse-plan-input"
            placeholder="反向计划 JSON（可选；不提供则该版本不可跨 Schema 回滚）"
            value={reversePlanText}
            onChange={(e) => setReversePlanText(e.target.value)}
          />
          <button
            type="button"
            data-testid="migration-submit"
            onClick={() => void submitWithPlan()}
          >
            带计划发布
          </button>
        </div>
      )}
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
