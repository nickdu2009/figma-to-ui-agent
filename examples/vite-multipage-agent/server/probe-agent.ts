import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { Observable } from "rxjs";
// pi-lens-ignore: ts:5097
import { SPEC_PATCH_EVENT_NAMES } from "./contracts.ts";

// 相对导入使用显式 .ts 扩展名：服务端以 Node 24 类型剥离直接运行。
// tsconfig 已启用 allowImportingTsExtensions；tsc --noEmit 通过。

/**
 * Transport 探针 Agent（G1 门禁）：不调用任何 LLM，按 run 输入脚本化输出
 * 计划 §5 末尾的四段探针场景：
 *
 *   run 1（无 resume、无工具结果）：文本片段 + ask_question TOOL_CALL
 *         + RUN_FINISHED(outcome=interrupt)。
 *   run 2（携带 resume）：spec.patch.start / delta（含一个 >1KB 大块）/ finish
 *         CUSTOM 事件 + await_apply_result TOOL_CALL
 *         + RUN_FINISHED(outcome=interrupt)。
 *   run 3（携带 await_apply_result 的工具结果）：文本回显收到的应用结果。
 */
export class ProbeAgent extends AbstractAgent {
  constructor() {
    super({
      agentId: "probe",
      description: "transport probe agent",
      debug: false,
    });
  }

  clone(): ProbeAgent {
    return new ProbeAgent();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const { threadId, runId } = input;
    const resume = input.resume ?? [];
    // 注意：messages 包含全量历史，必须看所有工具消息而不是第一条。
    const toolContents = input.messages
      .filter((m) => m.role === "tool")
      .map((m) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      );
    // CopilotKit v2 客户端把 interrupt resolve 结果以绑定 toolCallId 的
    // ToolMessage 形式（下一次 run）送回，而不是 input.resume。
    const isApplyResult = toolContents.some((c) =>
      c.includes('"status":"committed"'),
    );
    const isDecisionResult =
      !isApplyResult && (resume.length > 0 || toolContents.length > 0);
    const toolContent = toolContents[toolContents.length - 1] ?? "";

    return new Observable<BaseEvent>((subscriber) => {
      const emit = (event: BaseEvent) => subscriber.next(event);
      const timers: NodeJS.Timeout[] = [];
      const later = (ms: number, fn: () => void) => {
        timers.push(setTimeout(fn, ms));
      };

      emit({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);

      if (isApplyResult) {
        // run 3：回显 await_apply_result 的前端工具结果。
        const messageId = `${runId}-echo`;
        const content = "apply result received: " + toolContent;
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        } as BaseEvent);
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: content,
        } as BaseEvent);
        emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
        emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
        subscriber.complete();
        return;
      }

      if (!isDecisionResult) {
        // run 1：文本 + ask_question + interrupt outcome。
        const messageId = `${runId}-text`;
        const toolCallId = `${runId}-decision`;
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        } as BaseEvent);
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: "probe stage 1: text chunk",
        } as BaseEvent);
        emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
        emit({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: "ask_question",
        } as BaseEvent);
        emit({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: JSON.stringify({
            message: "probe decision",
            questions: [{
              id: "continue",
              header: "Probe",
              question: "continue probe?",
              options: [{ value: "continue", label: "Continue" }],
            }],
          }),
        } as BaseEvent);
        emit({ type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent);
        emit({
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          outcome: {
            type: "interrupt",
            interrupts: [
              {
                id: `${runId}-int-decision`,
                reason: "ask_question",
                toolCallId,
              },
            ],
          },
        } as BaseEvent);
        subscriber.complete();
        return;
      }

      // run 2：CUSTOM patch 事件流 + await_apply_result + interrupt outcome。
      const generationId = "gen-probe";
      const applyToolCallId = `${runId}-apply`;
      emit({
        type: EventType.CUSTOM,
        name: SPEC_PATCH_EVENT_NAMES.start,
        value: { generationId },
      } as BaseEvent);
      // 首个块 >1KB，用于验证 SSE 代理不被压缩/缓冲（计划 §8 门禁）。
      later(50, () => {
        emit({
          type: EventType.CUSTOM,
          name: SPEC_PATCH_EVENT_NAMES.delta,
          value: {
            generationId,
            text: `{"chunk":1,"pad":"${"x".repeat(2048)}"}\n`,
          },
        } as BaseEvent);
      });
      later(400, () => {
        emit({
          type: EventType.CUSTOM,
          name: SPEC_PATCH_EVENT_NAMES.delta,
          value: { generationId, text: `{"chunk":2}\n` },
        } as BaseEvent);
      });
      later(800, () => {
        emit({
          type: EventType.CUSTOM,
          name: SPEC_PATCH_EVENT_NAMES.finish,
          value: { generationId },
        } as BaseEvent);
        emit({
          type: EventType.TOOL_CALL_START,
          toolCallId: applyToolCallId,
          toolCallName: "await_apply_result",
        } as BaseEvent);
        emit({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: applyToolCallId,
          delta: JSON.stringify({ generationId }),
        } as BaseEvent);
        emit({
          type: EventType.TOOL_CALL_END,
          toolCallId: applyToolCallId,
        } as BaseEvent);
        emit({
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          outcome: {
            type: "interrupt",
            interrupts: [
              {
                id: `${runId}-int-apply`,
                reason: "await_apply",
                toolCallId: applyToolCallId,
              },
            ],
          },
        } as BaseEvent);
        subscriber.complete();
      });

      return () => {
        for (const t of timers) clearTimeout(t);
      };
    });
  }
}
