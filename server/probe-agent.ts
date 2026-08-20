import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { Observable } from "rxjs";
// pi-lens-ignore: ts:5097
import { SPEC_PATCH_EVENT_NAMES } from "./contracts.ts";

// 相对导入使用显式 .ts 扩展名：服务端以 Node 24 类型剥离直接运行。
// tsconfig 已启用 allowImportingTsExtensions；tsc --noEmit 通过。

/**
 * DSG-04：构造近似真实 uiBundle 的 finish 载荷（canonical JSON），
 * 总字节数略低于/超过 2 MiB 上限。载荷形状对齐设计 §7 的 AppUiBundle
 * 顶层结构，但内容为填充文本——探针只关心传输层行为。
 */
function buildGate00FinishValue(
  generationId: string,
  scenario: "probe" | "overflow",
  targetBytes: number,
): Record<string, unknown> {
  const skeleton = {
    generationId,
    __gate00: scenario,
    schemaVersion: 2,
    ui: {
      metadata: { title: { default: "Gate00 Probe" }, locale: "zh-CN" },
      tokens: {},
      componentTree: {},
      data: {},
      actions: {},
    },
    assets: {},
  };
  const envelopeBytes = Buffer.byteLength(
    JSON.stringify({ ...skeleton, ui: { ...skeleton.ui, padding: "" } }),
    "utf8",
  );
  const paddingLength = Math.max(targetBytes - envelopeBytes, 0);
  return {
    ...skeleton,
    ui: { ...skeleton.ui, padding: "g".repeat(paddingLength) },
  };
}

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
 *
 * DS-GATE-00 / DSG-04 追加场景（仅由消息文本触发，不影响以上三段）：
 *   "gate00-finish-probe"   ：完整 spec.patch 流，finish 携带约 1.98 MiB 的
 *         uiBundle 载荷（近上限、未超）。
 *   "gate00-finish-overflow"：同上，但载荷约 2.2 MiB（超上限），用于观察
 *         当前栈的断流/截断/413 行为（探针只记录，不做强制）。
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
    // DS-GATE-00 / DSG-04：由最后一条用户消息触发的大载荷 finish 探针。
    let gate00Scenario: "probe" | "overflow" | null = null;
    for (let i = input.messages.length - 1; i >= 0; i--) {
      const m = input.messages[i]!;
      if (m.role !== "user") continue;
      const text =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      if (text.includes("gate00-finish-probe")) gate00Scenario = "probe";
      else if (text.includes("gate00-finish-overflow"))
        gate00Scenario = "overflow";
      break;
    }
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

      if (gate00Scenario) {
        // DSG-04：完整 spec.patch 流 + 近 2MiB（或超限）uiBundle finish 载荷。
        const generationId =
          gate00Scenario === "probe"
            ? "gen-gate00-probe"
            : "gen-gate00-overflow";
        const targetBytes = gate00Scenario === "probe" ? 2_070_000 : 2_310_000; // ~1.974MiB / ~2.203MiB
        emit({
          type: EventType.CUSTOM,
          name: SPEC_PATCH_EVENT_NAMES.start,
          value: { generationId, __gate00: gate00Scenario },
        } as BaseEvent);
        later(100, () => {
          emit({
            type: EventType.CUSTOM,
            name: SPEC_PATCH_EVENT_NAMES.delta,
            value: { generationId, text: '{"chunk":1}\n' },
          } as BaseEvent);
        });
        later(300, () => {
          const finishValue = buildGate00FinishValue(
            generationId,
            gate00Scenario,
            targetBytes,
          );
          emit({
            type: EventType.CUSTOM,
            name: SPEC_PATCH_EVENT_NAMES.finish,
            value: finishValue,
          } as BaseEvent);
          emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
          subscriber.complete();
        });
        return () => {
          for (const t of timers) clearTimeout(t);
        };
      }

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
            questions: [
              {
                id: "continue",
                header: "Probe",
                question: "continue probe?",
                options: [{ value: "continue", label: "Continue" }],
              },
            ],
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
