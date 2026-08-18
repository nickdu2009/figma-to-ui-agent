/**
 * 发布预览装载（S6）：进入应用/刷新/发布/回滚后，以服务端当前发布版本
 * 重新装载预览。localStorage/URL 仅是恢复提示，事实以 /releases/current 为准。
 */
import { useEffect } from "react";
import type { NextAppRuntime } from "@next-app-runtime/client";

export const RELEASE_CHANGED_EVENT = "vma:release-changed";

export function notifyReleaseChanged(): void {
  window.dispatchEvent(new CustomEvent(RELEASE_CHANGED_EVENT));
}

export interface CurrentRelease {
  publishedVersionId: string;
  draftVersionId: string;
  publishedAt: string;
  spec: unknown;
  businessSchema: unknown;
}

export interface CurrentDraft {
  draftVersionId: string;
  generationRunId: string;
  createdAt: string;
  spec: unknown;
  businessSchema: unknown;
}

export async function fetchCurrentRelease(
  appId: string,
): Promise<CurrentRelease | null> {
  const res = await fetch(
    `/api/apps/${encodeURIComponent(appId)}/releases/current`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`加载发布版本失败：${res.status}`);
  const body = (await res.json()) as { current: CurrentRelease | null };
  return body.current;
}

/** owner/editor 编辑态刷新时优先恢复最新草稿；viewer 会收到 404 并回退发布版。 */
export async function fetchCurrentDraft(appId: string): Promise<CurrentDraft | null> {
  const res = await fetch(
    `/api/apps/${encodeURIComponent(appId)}/drafts/current`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`加载草稿版本失败：${res.status}`);
  const body = (await res.json()) as { current: CurrentDraft | null };
  return body.current;
}

export function PublishedPreviewLoader(props: {
  appId: string;
  runtime: NextAppRuntime;
}) {
  const { appId, runtime } = props;
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [draft, current] = await Promise.all([
          fetchCurrentDraft(appId),
          fetchCurrentRelease(appId),
        ]);
        if (cancelled) return;
        // 编辑者的最新草稿优先于已发布版本；viewer 只会得到发布版本。
        const preview = draft ?? current;
        if (preview) {
          await runtime.applySource({
            kind: "object",
            value: preview.spec as never,
          });
        }
        // 无草稿也无发布版本时保持空状态，不回填假数据
      } catch (error) {
        console.error("[published-preview] 装载失败：", error);
      }
    };
    void load();
    const onChanged = () => void load();
    window.addEventListener(RELEASE_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(RELEASE_CHANGED_EVENT, onChanged);
    };
  }, [appId, runtime]);
  return null;
}
