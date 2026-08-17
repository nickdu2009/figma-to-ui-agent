import { useEffect, useRef } from "react";
import {
  useFrontendTool,
  useInterrupt,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import type { ApplyResult } from "../server/contracts.ts";
import { getSharedPreviewRuntime } from "./preview-panel";
import { summarizeCurrentApp } from "./runtime/summarize-spec";
import { AskQuestionCard } from "./ask-question-card";
import { AskQuestionSummary } from "./ask-question-summary";
import { GenerationActivityCard } from "./generation-activity-card";
import { waitApplyResult } from "./runtime-apply-controller";

/**
 * 聊天工具协议的浏览器侧注册（计划 §5/§7）：
 * - get_current_spec / summarize_current_app：前端工具，直接读运行时快照；
 * - generate_spec：服务器工具，仅注册渲染卡（不注册 handler）；
 * - ask_question / await_apply_result：AG-UI 标准 interrupt，
 *   经 useInterrupt 渲染/程序化 resolve（探针结论：前端工具自动执行与
 *   未决 interrupt 会互相阻塞，因此收尾走 useInterrupt resolve 通道，
 *   结果作为绑定 toolCallId 的工具结果随下一次 run 返回）。
 */

const GENERATE_TOOL = "generate_spec";
const ASK_QUESTION_TOOL = "ask_question";
const AWAIT_APPLY_TOOL = "await_apply_result";

function parseGenerationId(result: unknown): string | undefined {
  if (typeof result !== "string") return undefined;
  try {
    const parsed = JSON.parse(result) as { generationId?: unknown };
    return typeof parsed.generationId === "string" ? parsed.generationId : undefined;
  } catch {
    return undefined;
  }
}

/** SourceResult → 协议 ApplyResult（rejected→failed、cancelled→aborted，计划 §6）。 */
function toApplyResult(
  generationId: string,
  source: { status: "committed" | "rejected" | "cancelled"; revision: number; error?: { message: string } },
): ApplyResult {
  if (source.status === "committed") {
    return { generationId, status: "committed", revision: source.revision };
  }
  if (source.status === "rejected") {
    return {
      generationId,
      status: "failed",
      revision: source.revision,
      error: source.error?.message ?? "applySource rejected",
    };
  }
  return { generationId, status: "aborted", revision: source.revision };
}

/**
 * await_apply_result 的不可见 interrupt 处理器：
 * 等待本地 applySource 落定后程序化 resolve（探针实证模式）。
 */
function AwaitApplyInterrupt(props: {
  generationId: string;
  resolve: (payload?: unknown) => Promise<unknown> | unknown;
}) {
  const fired = useRef(false);
  const { generationId, resolve } = props;
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void waitApplyResult(generationId).then((source) => {
      const payload = toApplyResult(generationId, source);
      console.warn(
        `[await-apply-interrupt] resolve generation=${generationId} source=${source.status} payload=${payload.status}`,
      );
      void Promise.resolve(resolve(payload)).then(
        () =>
          console.warn(
            `[await-apply-interrupt] resolve accepted generation=${generationId}`,
          ),
        (cause: unknown) =>
          console.warn(
            `[await-apply-interrupt] resolve rejected generation=${generationId} error=${cause instanceof Error ? cause.message.slice(0, 300) : "unknown"}`,
          ),
      );
    });
  }, [generationId, resolve]);
  return <div data-testid="await-apply-interrupt" style={{ display: "none" }} />;
}

export function CopilotKitTools(props: { agentId: string }) {
  const { agentId } = props;

  // 前端工具：get_current_spec —— 模型编辑前获取 current + revision。
  useFrontendTool({
    name: "get_current_spec",
    description:
      "获取当前已提交的应用 Spec 与 revision（无当前 Spec 时 hasCurrentSpec=false）。编辑现有应用前必须调用。",
    parameters: z.object({}),
    handler: async () => {
      const snapshot = getSharedPreviewRuntime().getSnapshot();
      return {
        hasCurrentSpec: snapshot.current != null,
        spec: snapshot.current ?? null,
        revision: snapshot.current == null ? null : snapshot.revision,
      };
    },
  });

  // 前端工具：summarize_current_app —— 问答路径的结构化摘要（不回传完整 Spec）。
  useFrontendTool({
    name: "summarize_current_app",
    description: "获取当前应用的结构化摘要（页面、导航、主要元素），用于回答用户关于当前界面的问题。",
    parameters: z.object({}),
    handler: async () => {
      const snapshot = getSharedPreviewRuntime().getSnapshot();
      return summarizeCurrentApp(snapshot.current ?? null);
    },
  });

  // 服务器工具 generate_spec 仅注册渲染卡（执行在服务端）。
  useRenderTool(
    {
      name: GENERATE_TOOL,
      parameters: z.object({
        request: z.string(),
        source: z.unknown(),
        target: z.unknown(),
      }),
      render: ({ status, result }) => (
        <GenerationActivityCard
          status={status}
          generationId={parseGenerationId(result)}
        />
      ),
    },
    [],
  );

  // 已完成的 ask_question 不再显示可点击的 interrupt 卡，而是作为可展开的
  // 聊天记录保留。未提交/中断的结果也如实标为“未提供答案”。
  useRenderTool(
    {
      name: ASK_QUESTION_TOOL,
      parameters: z.object({
        message: z.string(),
        questionSetId: z.string(),
        questions: z.array(
          z.object({
            id: z.string(),
            header: z.string(),
            question: z.string(),
            options: z.array(
              z.object({
                value: z.string(),
                label: z.string(),
                description: z.string().optional(),
                recommended: z.boolean().optional(),
              }),
            ),
            allowCustom: z.boolean().optional(),
            allowSkip: z.boolean().optional(),
          }),
        ),
      }),
      render: ({ status, parameters, result }) =>
        status === "complete" ? (
          <AskQuestionSummary questions={parameters.questions} result={result} />
        ) : (
          <div style={{ display: "none" }} />
        ),
    },
    [],
  );

  // ask_question / await_apply_result 的 interrupt 桥接。
  useInterrupt({
    agentId,
    render: ({ interrupt, resolve }) => {
      if (!interrupt) return <div data-testid="interrupt-unknown" />;
      if (interrupt.reason === AWAIT_APPLY_TOOL) {
        const generationId = interrupt.metadata?.generationId;
        if (typeof generationId !== "string") {
          // 协议损坏：fail closed，按 aborted 收尾。
          return (
            <AwaitApplyInterrupt
              generationId="__invalid__"
              resolve={() =>
                resolve({
                  generationId: "__invalid__",
                  status: "aborted",
                  error: "missing generationId in interrupt metadata",
                })
              }
            />
          );
        }
        return (
          <AwaitApplyInterrupt generationId={generationId} resolve={resolve} />
        );
      }
      if (interrupt.reason === ASK_QUESTION_TOOL) {
        const metadata = interrupt.metadata ?? {};
        if (!Array.isArray(metadata.questions)) {
          return <div data-testid="interrupt-unknown" />;
        }
        return (
          <AskQuestionCard
            questions={metadata.questions as never}
            resolve={(payload) => void resolve(payload)}
          />
        );
      }
      return <div data-testid="interrupt-unknown" />;
    },
  });

  return null;
}
