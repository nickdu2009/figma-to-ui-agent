/**
 * DownloadIntent Host（设计 §9.2，计划 S8 动作 9；DS-GATE-00 DSG-05 合同蓝本）。
 *
 * - beginDownloadIntent 只在真实同步 click/submit 栈由 Action handler 的同步
 *   前缀调用：预开同源空白、不可交互 target；popup 被阻止返回 null（稳定
 *   失败、无下载、不重试）。
 * - 异步正文完成后 completeDownload 恰好消费一次：在 target 内创建
 *   `<a download>` 触发真实下载，随后关闭 target 并尽快撤销 object URL
 *   （远低于 60s 上限）。
 * - 重复消费 → download_intent_already_consumed；phase revoke/取消后迟到
 *   完成 → download_intent_revoked；两者都不产生第二次下载。
 * - 页面卸载（pagehide）关闭全部 target 并撤销 URL。
 * - 字节只经本模块流入 Blob/object URL，不进入 Runtime state、Bundle、
 *   ActionResult、模型上下文或日志。
 */

export interface DownloadIntent {
  readonly id: string;
}

export type DownloadCompleteCode =
  | "download_intent_unknown"
  | "download_intent_revoked"
  | "download_intent_already_consumed";

export type DownloadCompleteResult =
  | { ok: true }
  | { ok: false; code: DownloadCompleteCode };

export interface DownloadIntentHost {
  /** 同步 user-gesture 栈内调用；popup 阻止返回 null。 */
  beginDownloadIntent(): DownloadIntent | null;
  /** 异步完成后一次性消费（重复/撤销后调用返回稳定错误，无副作用）。 */
  completeDownload(
    intent: DownloadIntent,
    fileName: string,
    bytes: Uint8Array,
    mimeType: string,
  ): DownloadCompleteResult;
  /** 失败/abort 路径：关闭 target、撤销 URL、移除句柄。 */
  cancelDownload(intent: DownloadIntent): void;
  /** phase revoke：全部未消费 intent 标记撤销（迟到完成稳定失败）。 */
  revokeAll(): void;
  /** 卸载清理（pagehide 自动调用；幂等）。 */
  dispose(): void;
}

interface IntentRecord {
  id: string;
  target: Window;
  consumed: boolean;
  revoked: boolean;
  url: string | null;
}

/** 成功排入下载后 target 关闭与 URL 撤销的延迟（设计上限 60s；实测 ~120ms）。 */
const CONSUME_CLEANUP_DELAY_MS = 120;

export function createDownloadIntentHost(options?: {
  /** 测试注入：替代 window.open（弹窗阻止模拟返回 null）。 */
  openTarget?: () => Window | null;
  /** 测试注入：替代定时器。 */
  setTimeoutImpl?: typeof setTimeout;
}): DownloadIntentHost {
  const openTarget =
    options?.openTarget ??
    (() => {
      try {
        // pi-lens-ignore: no-open-redirect
        return window.open("", "_blank");
      } catch {
        return null;
      }
    });
  const schedule = options?.setTimeoutImpl ?? setTimeout;
  const intents = new Map<string, IntentRecord>();
  let nextId = 1;
  let disposed = false;

  const closeTarget = (record: IntentRecord) => {
    try {
      record.target.close();
    } catch {
      // target 可能已被用户关闭
    }
  };

  const onPageHide = () => {
    dispose();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const record of intents.values()) {
      closeTarget(record);
      if (record.url) URL.revokeObjectURL(record.url);
    }
    intents.clear();
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", onPageHide);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
  }

  return {
    beginDownloadIntent() {
      if (disposed) return null;
      const target = openTarget();
      if (!target) return null;
      try {
        // 同源 about:blank 文档：仅设置占位标题（不用 deprecated document.write）
        target.document.title = "Preparing download…";
      } catch {
        // 非同源/已导航 target 不可写：按阻止处理
        try {
          target.close();
        } catch {
          // 忽略关闭失败
        }
        return null;
      }
      const record: IntentRecord = {
        id: `download-intent-${nextId++}`,
        target,
        consumed: false,
        revoked: false,
        url: null,
      };
      intents.set(record.id, record);
      return { id: record.id };
    },

    completeDownload(intent, fileName, bytes, mimeType) {
      const record = intents.get(intent.id);
      if (!record) return { ok: false, code: "download_intent_unknown" };
      if (record.revoked) return { ok: false, code: "download_intent_revoked" };
      if (record.consumed) {
        return { ok: false, code: "download_intent_already_consumed" };
      }
      record.consumed = true;
      const blob = new Blob([bytes as BlobPart], { type: mimeType });
      const url = URL.createObjectURL(blob);
      record.url = url;
      const anchor = record.target.document.createElement("a");
      anchor.download = fileName;
      anchor.href = url;
      record.target.document.body.append(anchor);
      anchor.click();
      schedule(() => {
        closeTarget(record);
        URL.revokeObjectURL(url);
        record.revoked = true;
        record.url = null;
        intents.delete(record.id);
      }, CONSUME_CLEANUP_DELAY_MS);
      return { ok: true };
    },

    cancelDownload(intent) {
      const record = intents.get(intent.id);
      if (!record) return;
      closeTarget(record);
      if (record.url) URL.revokeObjectURL(record.url);
      intents.delete(record.id);
    },

    revokeAll() {
      for (const record of intents.values()) {
        record.revoked = true;
        closeTarget(record);
        if (record.url) URL.revokeObjectURL(record.url);
        record.url = null;
      }
      intents.clear();
    },

    dispose,
  };
}
