/**
 * Bundle Preview 状态存储（设计 §5.1.1，计划 S4）。
 *
 * 宿主始终只有一个 active Runtime/Preview；候选 Runtime 只在有界 staging
 * 生命周期存在。本存储是 Controller 私有事实的唯一发布面：
 * - status 描述“最近一次 Controller 事务”的结果（staging 进行中 /
 *   ready 已提交 / failed 已失败）；failed 时 active 仍保留旧 revision，
 *   页面从不观察到半套 Runtime/CSS/Assets；
 * - active 氽远指向当前可交互的 Preview 句柄（bundle 事务原子切换）；
 * - toasts / openDialogElementIds 是 Adapter hostEffects（platformUi）的
 *   受控落点（S5 overlay 负责渲染）。
 *
 * 本模块不 import React 之外的外部状态，也不接触网络。
 */
import type { NextAppRuntime, NextAppSpec } from "@next-app-runtime/client";

import type { AppUiBundle } from "../catalog/app-ui-bundle.ts";
import type { Sha256Digest } from "../catalog/canonical-json.ts";
import type { PreviewNavigation } from "./preview-navigation.ts";

/** 执行绑定（设计 §5.1.1 execution；phase 单调、dispose 即 revoke）。 */
export type PreviewExecutionBinding =
  | { phase: "staging"; generationId: string }
  | { phase: "unsaved"; generationId: string }
  | {
      phase: "draft";
      generationId?: string;
      draftId: string;
    }
  | { phase: "published"; publishedVersionId: string };

/** active Preview 句柄：Runtime + Bundle 提交单元的描述性元数据。 */
export interface ActivePreviewHandle {
  runtime: NextAppRuntime;
  /** 候选/active 各自持有的内存导航（切换时原子替换，不改宿主 URL）。 */
  navigation: PreviewNavigation;
  /** Controller 单调计数；Preview root 以 `${bundleRevision}:${revision}` 为 key。 */
  bundleRevision: number;
  /** 提交时 Runtime 的 revision。 */
  runtimeRevision: number;
  /** v1 合成 digest（v1gen:/draft:/published:）或 v2 sha256；描述性元数据。 */
  candidateDigest: string;
  /** v2 Bundle 路径才有；v1 spec-only 兼容路径为 null。 */
  uiBundleDigest: Sha256Digest | null;
  execution: PreviewExecutionBinding;
  /** v2 权威 AppUiBundle；v1 兼容期为 null（S13 兼容回填后恒有值）。 */
  bundle: AppUiBundle | null;
  /** 最近一次提交的 spec（v1 在位事实与 v2 bundle.spec 同源）。 */
  spec: NextAppSpec | null;
  /**
   * S6：编译后的应用 CSS（token 变量 + 作用域选择器 + 资源 URL 已替换）。
   * v1 兼容路径为 null（旧固定样式）。仅存 Controller 内存，不进 state/Bundle。
   */
  designCss: string | null;
  /** S6：本代资源句柄的销毁钩（旧代在切换完成后销毁）。 */
  disposeAssets: (() => void) | null;
}

export type PlatformToastVariant =
  | "default"
  | "success"
  | "warning"
  | "error";

export interface PlatformToast {
  id: string;
  variant: PlatformToastVariant;
  title: string;
  description?: string;
  createdAt: number;
}

export interface BundlePreviewSnapshot {
  /** 最近一次事务状态；failed 不移除 active（旧 revision 继续可用）。 */
  status: "empty" | "staging" | "ready" | "failed";
  active: Readonly<ActivePreviewHandle> | null;
  toasts: readonly PlatformToast[];
  openDialogElementIds: readonly string[];
}

const EMPTY_SNAPSHOT: BundlePreviewSnapshot = Object.freeze({
  status: "empty",
  active: null,
  toasts: Object.freeze([]),
  openDialogElementIds: Object.freeze([]),
});

const MAX_TOASTS = 3;
const MAX_OPEN_DIALOGS = 32;
const TOAST_TTL_MS = 5_000;

export class BundlePreviewStore {
  private listeners = new Set<() => void>();
  private snapshot: BundlePreviewSnapshot = EMPTY_SNAPSHOT;
  private toastTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private toastCounter = 0;
  private dialogIds: string[] = [];
  private version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** useSyncExternalStore 的稳定版本号（快照不可变，版本单调递增）。 */
  getVersion = (): number => this.version;

  getSnapshot = (): BundlePreviewSnapshot => this.snapshot;

  /** 事务进行中（staging 期间 active 保持旧 revision）。 */
  beginStaging(): void {
    this.snapshot = Object.freeze({
      ...this.snapshot,
      status: "staging",
    });
    this.notify();
  }

  /** 原子提交：一次更新 status/active（单次 notify = 单个 React commit）。 */
  commitActive(handle: ActivePreviewHandle): void {
    this.snapshot = Object.freeze({
      ...this.snapshot,
      status: "ready",
      active: Object.freeze({ ...handle }),
    });
    this.notify();
  }

  markFailed(): void {
    if (this.snapshot.status === "staging") {
      this.snapshot = Object.freeze({ ...this.snapshot, status: "failed" });
      this.notify();
    }
  }

  /**
   * 就地更新 active 的执行绑定（staging→unsaved→draft 单调推进的落点）。
   * 不重建 handle、不改 status：同一 runtime/revision 下 Preview root 的
   * key 不变，因此 Preview Commit 响应不会重复播放淡入动画。
   */
  updateActiveExecution(execution: PreviewExecutionBinding): void {
    const active = this.snapshot.active;
    if (!active) return;
    this.snapshot = Object.freeze({
      ...this.snapshot,
      active: Object.freeze({ ...active, execution }),
    });
    this.notify();
  }

  /** Controller dispose：清空 active，宿主随组件卸载。 */
  clearActive(): void {
    this.snapshot = Object.freeze({ ...this.snapshot, active: null });
    this.notify();
  }

  pushToast(input: {
    variant: PlatformToastVariant;
    title: string;
    description?: string;
  }): string {
    this.toastCounter += 1;
    const id = `toast_${this.toastCounter}`;
    const toasts = [...this.snapshot.toasts, { ...input, id, createdAt: Date.now() }];
    // 有界：超限丢弃最旧的 toast（并取消其过期计时器）。
    while (toasts.length > MAX_TOASTS) {
      const dropped = toasts.shift();
      if (dropped) this.cancelToastTimer(dropped.id);
    }
    this.snapshot = Object.freeze({ ...this.snapshot, toasts: Object.freeze(toasts) });
    this.notify();
    const timer = setTimeout(() => this.dismissToast(id), TOAST_TTL_MS);
    this.toastTimers.set(id, timer);
    return id;
  }

  dismissToast(id: string): void {
    this.cancelToastTimer(id);
    const toasts = this.snapshot.toasts.filter((toast) => toast.id !== id);
    if (toasts.length === this.snapshot.toasts.length) return;
    this.snapshot = Object.freeze({ ...this.snapshot, toasts: Object.freeze(toasts) });
    this.notify();
  }

  setDialogOpen(elementId: string, open: boolean): void {
    const current = this.dialogIds;
    let next: string[];
    if (open) {
      if (current.includes(elementId)) return;
      next = [...current, elementId].slice(-MAX_OPEN_DIALOGS);
    } else {
      if (!current.includes(elementId)) return;
      next = current.filter((id) => id !== elementId);
    }
    this.dialogIds = next;
    this.snapshot = Object.freeze({
      ...this.snapshot,
      openDialogElementIds: Object.freeze(next),
    });
    this.notify();
  }

  /** dispose：清空计时器，防止 dispose 后再触发 notify。 */
  shutdown(): void {
    for (const timer of this.toastTimers.values()) clearTimeout(timer);
    this.toastTimers.clear();
    this.listeners.clear();
  }

  private cancelToastTimer(id: string): void {
    const timer = this.toastTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.toastTimers.delete(id);
    }
  }

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
