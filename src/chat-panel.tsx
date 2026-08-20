import { CopilotChat, useAgent } from "@copilotkit/react-core/v2";
import { CopilotKitTools } from "./copilotkit-tools";
import { RuntimeApplyController } from "./runtime-apply-controller";
import type { BundlePreviewController } from "./runtime/bundle-preview-controller.ts";

/**
 * 聊天面板（计划 §4 左栏）：
 * - CopilotChat：预置聊天 UI（消息流、输入框、停止按钮）；
 * - CopilotKitTools：四工具前端注册 + interrupt 桥接（不可见）；
 * - RuntimeApplyController：spec.patch.* → BundlePreviewController
 *   候选事务桥（不可见；S4 起不再直接 applySource）。
 */
export function ChatPanel(props: {
  agentId: string;
  appId: string;
  controller: BundlePreviewController;
}) {
  const { agentId, appId, controller } = props;
  // CopilotChat 的输入框可在初始 transport/工具注册尚未完成时短暂可交互。
  // 首条消息若此时发出，AG-UI run 会拿到空的前端工具表，造成问卷事件丢失。
  // RuntimeApplyController 已提前 useAgent 注册同一 agent；此处只在连接 ready
  // 后才挂载可发送的聊天框，保持首次消息与后续消息一致。
  const { isReady } = useAgent({ agentId });
  return (
    <section data-testid="chat-panel" className="chat-panel">
      <CopilotKitTools agentId={agentId} controller={controller} />
      <RuntimeApplyController
        agentId={agentId}
        appId={appId}
        controller={controller}
      />
      {isReady ? (
        <CopilotChat agentId={agentId} className="chat-thread" />
      ) : (
        <div data-testid="chat-connecting" className="chat-thread">
          正在连接助手…
        </div>
      )}
    </section>
  );
}
