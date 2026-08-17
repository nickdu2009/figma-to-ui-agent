/**
 * 发布预览装载（S6）：进入应用/刷新/发布/回滚后，以服务端当前发布版本
 * 重新装载预览。localStorage/URL 仅是恢复提示，事实以 /releases/current 为准。
 */
import { useEffect } from "react";
import { getSharedPreviewRuntime } from "../preview-panel";

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

export function PublishedPreviewLoader(props: { appId: string }) {
  const { appId } = props;
  useEffect(() => {
    let cancelled = false;
    const runtime = getSharedPreviewRuntime();
    const load = async () => {
      try {
        const current = await fetchCurrentRelease(appId);
        if (cancelled) return;
        if (current) {
          await runtime.applySource({
            kind: "object",
            value: current.spec as never,
          });
        }
        // 无发布版本时保持草稿/空状态，不回填假数据
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
  }, [appId]);
  return null;
}
