import { CopilotChat } from "@copilotkit/react-core/v2";
import { CopilotKitTools } from "./copilotkit-tools";
import { RuntimeApplyController } from "./runtime-apply-controller";
import type { NextAppRuntime } from "@next-app-runtime/client";

/**
 * 聊天面板（计划 §4 左栏）：
 * - CopilotChat：预置聊天 UI（消息流、输入框、停止按钮）；
 * - CopilotKitTools：四工具前端注册 + interrupt 桥接（不可见）；
 * - RuntimeApplyController：spec.patch.* → applySource 唯一调用点（不可见）。
 */
export function ChatPanel(props: {
 agentId: string;
 appId: string;
 runtime: NextAppRuntime;
}) {
 const { agentId, appId, runtime } = props;
 return (
  <section data-testid="chat-panel" className="chat-panel">
   <CopilotKitTools agentId={agentId} runtime={runtime} />
   <RuntimeApplyController agentId={agentId} appId={appId} runtime={runtime} />
   <CopilotChat agentId={agentId} className="chat-thread" />
  </section>
 );
}
