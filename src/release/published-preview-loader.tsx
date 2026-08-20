/**
 * 发布预览装载（S6；S4 起经 BundlePreviewController 候选事务）：
 * 进入应用/刷新/发布/回滚后，以服务端当前发布版本重新装载预览。
 * localStorage/URL 仅是恢复提示，事实以 /releases/current 为准。
 * 每次装载都走候选 Runtime + 原子切换（draft/published gate）；
 * 失败时保留旧 revision（Controller 语义），不写半套状态。
 */
import { useEffect } from "react";
import type { BundlePreviewController } from "../runtime/bundle-preview-controller.ts";

import type { AppUiBundle } from "../catalog/app-ui-bundle.ts";

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
  bundle?: AppUiBundle | null;
  catalogVersion?: string | null;
  candidateDigest?: string | null;
  uiBundleDigest?: string | null;
}

export interface CurrentDraft {
  draftVersionId: string;
  generationRunId: string;
  createdAt: string;
  spec: unknown;
  businessSchema: unknown;
  bundle?: AppUiBundle | null;
  catalogVersion?: string | null;
  candidateDigest?: string | null;
  uiBundleDigest?: string | null;
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
export async function fetchCurrentDraft(
  appId: string,
): Promise<CurrentDraft | null> {
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
  controller: BundlePreviewController;
}) {
  const { appId, controller } = props;
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
        if (draft) {
          const result = await controller.stagePersisted({
            spec: draft.spec,
            bundle: draft.bundle,
            execution: {
              phase: "draft",
              draftId: draft.draftVersionId,
              generationId: draft.generationRunId,
            },
          });
          if (result.status === "rejected") {
            console.warn(
              "[published-preview] draft 装载被拒绝：",
              result.error.code,
            );
          }
        } else if (current) {
          const result = await controller.stagePersisted({
            spec: current.spec,
            bundle: current.bundle,
            execution: {
              phase: "published",
              publishedVersionId: current.publishedVersionId,
            },
          });
          if (result.status === "rejected") {
            console.warn(
              "[published-preview] release 装载被拒绝：",
              result.error.code,
            );
          }
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
  }, [appId, controller]);
  return null;
}
