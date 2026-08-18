import { useSyncExternalStore } from "react";
import { patchLogStore } from "./patch-log-store";
import {
  getApplyState,
  getApplyStateVersion,
  getLatestApplyState,
  subscribeApplyStates,
} from "./runtime-apply-controller";

/**
 * generate_spec 执行与提交状态卡（useRenderTool 渲染目标）。
 *
 * 状态文案固定（计划 §4）：
 * “准备生成 → 正在生成应用 → 正在更新预览 → 已更新 / 更新失败”。
 * patch_streaming 绝不显示为“已更新”；只有 await_apply_result 回传
 * committed（即 runtime.applySource committed）后才显示成功。
 *
 * 卡片不显示 Patch 原文、runId 或 toolCallId；Patch 日志默认折叠。
 */
export function GenerationActivityCard(props: {
  status: "inProgress" | "executing" | "complete";
  generationId?: string;
}) {
  // 真实模型会产生数千个 token 级片段。完整日志仍保存在 PatchLogStore
  // 供诊断使用，但不能每片段都把整个数组挂到 DOM 上，否则会造成 O(n²)
  // 重渲染并阻塞页面主线程。
  const maxRenderedLogEntries = 240;
  // useSyncExternalStore 的 getSnapshot 必须返回缓存值（单调递增版本号），
  // 否则触发无限重渲染（React 运行时错误）。
  useSyncExternalStore(subscribeApplyStates, getApplyStateVersion, () => 0);
  useSyncExternalStore(
    patchLogStore.subscribe.bind(patchLogStore),
    () => patchLogStore.version,
    () => 0,
  );

  // generationId 正常来自 generate_spec 工具结果；run 被中止时 runner 合成
  // 的 stopped 结果不含 generationId，退回最近开始的 generation（协议串行）。
  const applyState = props.generationId
    ? getApplyState(props.generationId)
    : getLatestApplyState();

  let label: string;
  let tone: "running" | "success" | "failure" = "running";
  if (
    applyState?.status === "settled" &&
    applyState.result?.status === "committed"
  ) {
    label = "已更新";
    tone = "success";
  } else if (
    applyState?.status === "settled" &&
    (applyState.result?.status === "rejected" ||
      applyState.result?.status === "cancelled")
  ) {
    label = "更新失败";
    tone = "failure";
  } else if (props.status === "executing" || props.status === "complete") {
    label = "正在更新预览";
  } else if (props.status === "inProgress") {
    label = "准备生成";
  } else {
    label = "正在生成应用";
  }

  const logEntries = props.generationId
    ? patchLogStore.get(props.generationId)
    : [];
  const renderedLogEntries = logEntries.slice(0, maxRenderedLogEntries);

  return (
    <div
      data-testid="generation-card"
      className={`generation-card generation-${tone}`}
    >
      <span data-testid="generation-status" className="generation-status">
        {label}
      </span>
      {logEntries.length > 0 ? (
        <details className="generation-log">
          <summary>技术详情（{logEntries.length} 段）</summary>
          <ol>
            {renderedLogEntries.map((entry, index) => (
              <li key={index}>
                <code>
                  {entry.text.length > 120
                    ? `${entry.text.slice(0, 120)}…`
                    : entry.text}
                </code>
              </li>
            ))}
          </ol>
          {logEntries.length > renderedLogEntries.length ? (
            <p>
              为避免阻塞页面，仅显示前 {maxRenderedLogEntries} 段；完整日志仍保留在当前浏览器内存中。
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
