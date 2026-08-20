import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { Observable } from "rxjs";
import type { AskQuestionInput, GenerateSpecInput } from "./contracts.ts";
import type { GenerationCoordinator } from "./generation-coordinator.ts";
import {
  brokenPatchLines,
  cannedPlan,
  createOps,
  createPatchLines,
  editOps,
  editPatchLines,
} from "./mock-fixtures.ts";
import type { AppUiBundle } from "../src/catalog/app-ui-bundle.ts";
import {
  CATALOG_VERSION,
  SPEC_COMPATIBILITY,
} from "../src/catalog/catalog-contract.ts";

// 相对导入使用显式 .ts 扩展名：服务端以 Node 24 类型剥离直接运行。
// tsconfig 已启用 allowImportingTsExtensions；tsc --noEmit 通过。

/** 补丁 delta 之间的间隔，便于浏览器观察增量更新。可用
 * VMA_MOCK_PATCH_INTERVAL_MS 调整（中止测试需要更宽的流式窗口）。 */
/**
 * mock 的候选 Spec 重建：fixtures 只含 add 型 RFC 6902 ops，
 * 服务端必须持有权威候选（createDraftAndMarkSucceeded 要求 candidateSpec 非空）。
 */
type MockPatchOp = { op: string; path: string; value?: unknown };

function unescapePointer(seg: string): string {
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}

function applyAddOps(base: unknown, ops: MockPatchOp[]): unknown {
  const root = structuredClone(base ?? {}) as Record<string, unknown>;
  for (const op of ops) {
    const segs = op.path.split("/").slice(1).map(unescapePointer);
    let node: unknown = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const key = segs[i];
      node = Array.isArray(node)
        ? node[Number(key)]
        : (node as Record<string, unknown>)[key];
    }
    const last = segs[segs.length - 1];
    if (Array.isArray(node)) {
      if (last === "-") node.push(op.value);
      else node.splice(Number(last), 0, op.value);
    } else {
      (node as Record<string, unknown>)[last] = op.value;
    }
  }
  return root;
}

/** 每线程最近一次已发出的 Spec（mock 内 base=current 的基准）。 */
const lastSpecByThread = new Map<string, unknown>();

const PATCH_DELTA_INTERVAL_MS = Number(
  process.env.VMA_MOCK_PATCH_INTERVAL_MS ?? 80,
);

const QUESTION_TOOL = "ask_question";
const GENERATE_TOOL = "generate_spec";

const messageText = (content: unknown): string =>
  typeof content === "string" ? content : JSON.stringify(content);

/**
 * 脚本化 Mock 聊天 Agent（VMA_AGENT_MODE=mock，浏览器 E2E 用，不调 LLM）。
 * 作为 CoordinatedMastraAgent 的内层 agent：只产出标准 AG-UI 事件，
 * 并通过 GenerationCoordinator 驱动 spec.patch.* CUSTOM 事件；
 * ask_question 的 interrupt outcome 由外层注入；生成结束与生产路径同样走
 * Candidate → validation → Preview Commit，绝不模拟 await_apply_result。
 *
 * 场景脚本（按 input 内容判定，优先级从上到下）：
 *   A. 工具消息含 answers 中 approve
 *      → 批准后的生成 run：TOOL_CALL generate_spec（approved_plan, base=empty）
 *        + 经 Coordinator 流出 createPatchLines（delta 间隔 80ms）
 *        + TOOL_CALL_RESULT + RUN_FINISHED（普通）。
 *   C. 工具消息含 other/skip → 文本请求补充说明后 RUN_FINISHED。
 *   D. 最后一条 user 消息含 “问答”/“哪些页面” → 纯文本回答（不调用工具）。
 *   E. 最后一条 user 消息含 “坏补丁” → generate_spec 流出非法 JSONL。
 *   F. 最后一条 user 消息含 “编辑”/“修改”/“增加”
 *      → generate_spec（direct_edit, base=current）流出 editPatchLines。
 *   G. 其他 → run1：TOOL_CALL ask_question（计划确认）
 *      + RUN_FINISHED（普通）。
 *
 * 注意：messages 为全量历史，判断工具结果时必须扫描全部工具消息；
 * RUN_FINISHED 之后不再发任何事件。
 */
export class MockChatAgent extends AbstractAgent {
  // 注意：不用 TS 参数属性（parameter property）——Node 24 类型剥离
  // （strip-only）不支持该语法，本目录要求可直接类型剥离运行。
  private readonly coordinator: GenerationCoordinator;

  constructor(coordinator: GenerationCoordinator) {
    super({
      agentId: "chat",
      description: "scripted mock chat agent",
      debug: false,
    });
    this.coordinator = coordinator;
  }

  clone(): MockChatAgent {
    return new MockChatAgent(this.coordinator);
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const { threadId, runId } = input;
    // 场景判定只看「最后一条 user 消息之后」的工具结果——messages 为全量历史，
    // 历史上的 approve/respond/apply 结果不得影响后续 user turn 的场景选择
    // （否则创建流程之后的编辑/坏补丁/问答会被历史 approve 永远抢占）。
    const lastUserIndex = input.messages.reduce(
      (acc, m, i) => (m.role === "user" ? i : acc),
      -1,
    );
    const recentToolContents = input.messages
      .slice(lastUserIndex + 1)
      .filter((m) => m.role === "tool")
      .map((m) => messageText(m.content));
    const lastUser =
      lastUserIndex >= 0 ? input.messages[lastUserIndex] : undefined;
    const lastUserText = lastUser ? messageText(lastUser.content) : "";

    const isApproved = recentToolContents.some((c) =>
      c.includes('"value":"approve"'),
    );
    const isResponded = recentToolContents.some(
      (c) => c.includes('"value":"other"') || c.includes('"value":"skip"'),
    );
    const isQuestionnaireAnswered = recentToolContents.some((c) =>
      c.includes('"questionId":"audience"'),
    );

    return new Observable<BaseEvent>((subscriber) => {
      const emit = (event: BaseEvent) => subscriber.next(event);
      const timers: NodeJS.Timeout[] = [];
      const later = (ms: number, fn: () => void) => {
        timers.push(setTimeout(fn, ms));
      };
      const finishTextRun = (text: string) => {
        const messageId = `${runId}-text`;
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        } as BaseEvent);
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: text,
        } as BaseEvent);
        emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
        emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
        subscriber.complete();
      };
      /** 模拟服务器工具 generate_spec，走与生产相同的 v2 最终收尾。 */
      const runGeneration = (
        args: GenerateSpecInput,
        lines: string[],
        candidateSpec?: unknown,
      ) => {
        const toolCallId = `${runId}-generate-spec`;
        const generationId = `mock-gen-${runId}`;
        emit({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: GENERATE_TOOL,
        } as BaseEvent);
        emit({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: JSON.stringify(args),
        } as BaseEvent);
        emit({ type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent);
        this.coordinator.beginGeneration({ threadId, runId, generationId });
        lines.forEach((line, index) => {
          later(PATCH_DELTA_INTERVAL_MS * (index + 1), () => {
            this.coordinator.emitPatchDelta(
              threadId,
              runId,
              generationId,
              line,
            );
          });
        });
        // 为中止路径保留可观察的流式窗口。两条 edit patch 在本地极快完成，
        // 若立即进入 validation，浏览器的 stop 事件会落在终态之后而失去验证意义。
        const completionDelay = Math.max(
          PATCH_DELTA_INTERVAL_MS * (lines.length + 1),
          3_000,
        );
        later(completionDelay, () => {
          let candidatePayload: unknown;
          if (candidateSpec) {
            const bundle: AppUiBundle = {
              bundleVersion: 1,
              catalogVersion: CATALOG_VERSION,
              specCompatibility: SPEC_COMPATIBILITY,
              spec: candidateSpec as AppUiBundle["spec"],
              designSystem: {
                tokens: { primitive: {}, semantic: {}, component: {} },
                applicationCss: "",
              },
              assets: { entries: [] },
            };
            candidatePayload = {
              uiBundle: bundle,
              businessSchema: null,
              migrationEdge: {
                fromPublishedVersionId: null,
                fromSchemaDigest:
                  "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                toSchemaDigest:
                  "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
              },
            };
          }
          const completeToolRun = (status: "patch_streaming" | "failed") => {
            emit({
              type: EventType.TOOL_CALL_RESULT,
              messageId: `${runId}-generate-spec-result`,
              toolCallId,
              content: JSON.stringify({ status, generationId }),
              role: "tool",
            } as BaseEvent);
            emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
            subscriber.complete();
          };
          if (!candidatePayload) {
            this.coordinator.failPatchStream(
              threadId,
              runId,
              generationId,
              "mock_candidate_missing",
            );
            completeToolRun("failed");
            return;
          }
          void this.coordinator
            .finishValidatedCandidate(
              threadId,
              runId,
              generationId,
              candidatePayload,
              { totalOperations: lines.length },
            )
            .then(() => completeToolRun("patch_streaming"))
            .catch((error: unknown) => {
              this.coordinator.failPatchStream(
                threadId,
                runId,
                generationId,
                error instanceof Error ? error.message : "mock_generation_failed",
              );
              completeToolRun("failed");
            });
        });
      };

      emit({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);

      // A：批准后的生成 run（approved_plan, base=empty）。
      if (isApproved) {
        runGeneration(
          {
            request: "根据已确认的计划创建应用",
            // Mock 直接驱动 coordinator Patch 流，不执行真实 generate_spec，
            // 因此该 ID 只满足前端工具参数形状。
            source: { kind: "approved_plan", questionSetId: "mock-question" },
            target: { base: "empty" },
          },
          createPatchLines,
          (() => {
            const spec = applyAddOps({}, createOps);
            lastSpecByThread.set(threadId, spec);
            return spec;
          })(),
        );
        return () => {
          for (const t of timers) clearTimeout(t);
        };
      }

      // C：用户以 respond 回复决策。
      if (isResponded) {
        finishTextRun("收到调整意见，请补充说明。");
        return () => {
          for (const t of timers) clearTimeout(t);
        };
      }

      if (isQuestionnaireAnswered) {
        finishTextRun("已收到两项回答，将据此继续规划。");
        return () => {
          for (const t of timers) clearTimeout(t);
        };
      }

      // D：普通问答，不调用任何工具。
      if (lastUserText.includes("问答") || lastUserText.includes("哪些页面")) {
        finishTextRun("当前应用有首页、定价和文档三个页面……");
        return () => {
          for (const t of timers) clearTimeout(t);
        };
      }

      // E：坏补丁演示（direct_edit, base=empty），流出非法 JSONL。
      if (lastUserText.includes("坏补丁")) {
        runGeneration(
          {
            request: "演示非法补丁（应被运行时拒绝并保留旧预览）",
            source: { kind: "direct_edit" },
            target: { base: "empty" },
          },
          brokenPatchLines,
        );
        return () => {
          for (const t of timers) clearTimeout(t);
        };
      }

      // F：直接编辑（direct_edit, base=current）。
      if (
        lastUserText.includes("编辑") ||
        lastUserText.includes("修改") ||
        lastUserText.includes("增加")
      ) {
        runGeneration(
          {
            request: "在定价页追加一张方案卡片",
            source: { kind: "direct_edit" },
            target: { base: "current", baseRevision: 1, currentSpec: {} },
          },
          editPatchLines,
          (() => {
            // CopilotKit 可能为新用户轮换 threadId；Mock 的固定创建夹具在
            // 这种情况下仍须产生完整、可验证的编辑 Candidate，而不能退化成
            // 无 Bundle 的旧 await_apply 路径。
            const base =
              lastSpecByThread.get(threadId) ?? applyAddOps({}, createOps);
            const spec = applyAddOps(base, editOps);
            lastSpecByThread.set(threadId, spec);
            return spec;
          })(),
        );
        return () => {
          for (const t of timers) clearTimeout(t);
        };
      }

      if (lastUserText.includes("多题问卷")) {
        const toolCallId = `${runId}-questionnaire`;
        emit({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: QUESTION_TOOL,
        } as BaseEvent);
        emit({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: JSON.stringify({
            message: "先确认两个关键选择。",
            questions: [
              {
                id: "audience",
                header: "目标用户",
                question: "主要给谁使用？",
                options: [
                  {
                    value: "individual",
                    label: "个人用户",
                    description: "聚焦个人任务管理。",
                    recommended: true,
                  },
                  {
                    value: "team",
                    label: "小团队协作",
                    description: "需要成员与共享任务。",
                  },
                ],
              },
              {
                id: "scope",
                header: "首版范围",
                question: "首版做到哪一档？",
                options: [
                  {
                    value: "mvp",
                    label: "标准 MVP",
                    description: "包含增删改查与筛选。",
                    recommended: true,
                  },
                  {
                    value: "minimal",
                    label: "极简清单",
                    description: "先验证基础任务流。",
                  },
                ],
                allowCustom: true,
                allowSkip: true,
              },
            ],
          }),
        } as BaseEvent);
        emit({ type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent);
        emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
        subscriber.complete();
        return () => {
          for (const t of timers) clearTimeout(t);
        };
      }

      // G：run1，请求计划确认（interrupt outcome 由外层自动注入）。
      const toolCallId = `${runId}-decision`;
      const questionInput: Omit<AskQuestionInput, "questionSetId"> = {
        message: "计划如下",
        plan: cannedPlan,
        questions: [
          {
            id: "confirm_plan",
            header: "应用计划",
            question: "是否按这个计划开始生成？",
            options: [
              {
                value: "approve",
                label: "开始生成",
                description: "按当前计划创建应用。",
                recommended: true,
              },
              {
                value: "revise",
                label: "调整计划",
                description: "输入需要修改的方向。",
              },
            ],
            allowCustom: true,
          },
        ],
      };
      emit({
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: QUESTION_TOOL,
      } as BaseEvent);
      emit({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify(questionInput),
      } as BaseEvent);
      emit({ type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent);
      emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
      subscriber.complete();

      return () => {
        for (const t of timers) clearTimeout(t);
      };
    });
  }
}
