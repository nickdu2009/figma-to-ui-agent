import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  RuntimeError,
  type NextAppRuntime,
  type SourceResult,
} from "@next-app-runtime/client";
import { useAgent } from "@copilotkit/react-core/v2";
import { patchLogStore } from "./patch-log-store";
import type { BundlePreviewController } from "./runtime/bundle-preview-controller.ts";

/**
 * RuntimeApplyController（S4 起）：AG-UI 事件桥（不再直接 applySource）。
 *
 * 订阅 AG-UI CUSTOM 事件 spec.patch.*：
 * - start：记录 generation 与基线，但不触碰预览；
 * - delta：仅缓存 UTF-8 Patch 并追加到 patchLogStore；
 * - finish：把完整补丁文本交给唯一的 BundlePreviewController（候选 Runtime
 *   事务：staging→单次 applySource→smoke→原子切换→unsaved）；
 * - error 或中止：abort 并丢弃该 generation，保留最后一份有效预览。
 *
 * 应用结果通过 waitApplyResult(generationId) 提供给 await_apply_result 的
 * interrupt 处理器；generationId 不匹配的陈旧事件一律忽略。
 */

export type GenerationApplyState = {
  generationId: string;
  status: "streaming" | "settled";
  result?: SourceResult;
  waiters: Array<(result: SourceResult) => void>;
  abort: AbortController;
  base: "empty" | "current";
  chunks: string[];
  /** finish 事件已到达，补丁数据完整，允许 applySource 原子提交。 */
  writerClosed: boolean;
};

class ApplyStateStore {
  private states = new Map<string, GenerationApplyState>();
  private listeners = new Set<() => void>();
  /** 单调递增版本号，作为 useSyncExternalStore 的稳定快照。 */
  version = 0;

  get(generationId: string): GenerationApplyState | undefined {
    return this.states.get(generationId);
  }

  upsert(state: GenerationApplyState): void {
    this.states.set(state.generationId, state);
    this.notify();
  }

  notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 停止：中止进行中的 generation（模型请求 + applySource）。 */
  abortAll(): void {
    for (const state of this.states.values()) {
      if (state.status === "streaming") state.abort.abort();
    }
  }

  /**
   * 运行失败/用户停止：只中止补丁流未完成的 generation（writer 未关闭）。
   * 已收到 finish 的 generation 数据完整，让 applySource 正常收尾，
   * 保持预览与协议的一致性。
   */
  abortIncomplete(): GenerationApplyState[] {
    const aborted: GenerationApplyState[] = [];
    for (const state of this.states.values()) {
      if (state.status === "streaming" && !state.writerClosed) {
        state.abort.abort();
        aborted.push(state);
      }
    }
    return aborted;
  }

  /** 最近开始的 generation（Map 保持插入序）。 */
  latest(): GenerationApplyState | undefined {
    let last: GenerationApplyState | undefined;
    for (const state of this.states.values()) last = state;
    return last;
  }

  /** 进行中的 generationId（S3 心跳扫描用）。 */
  streamingGenerationIds(): string[] {
    const ids: string[] = [];
    for (const state of this.states.values()) {
      if (state.status === "streaming") ids.push(state.generationId);
    }
    return ids;
  }
}

const applyStateStore = new ApplyStateStore();

export function getApplyState(
  generationId: string,
): GenerationApplyState | undefined {
  return applyStateStore.get(generationId);
}

/**
 * 最近开始的 generation。生成卡的 generationId 正常情况下从 generate_spec
 * 工具结果解析；run 被中止时 runner 合成的 stopped 结果不含 generationId，
 * 卡片退回使用最近开始的 generation（协议上 generation 严格串行）。
 */
export function getLatestApplyState(): GenerationApplyState | undefined {
  return applyStateStore.latest();
}

export function subscribeApplyStates(listener: () => void): () => void {
  return applyStateStore.subscribe(listener);
}

/** useSyncExternalStore 的稳定快照（缓存值，单调递增）。 */
export function getApplyStateVersion(): number {
  return applyStateStore.version;
}

/** 运行失败/停止时调用：中止补丁流未完成的 generation。 */
function settleCancelled(state: GenerationApplyState, revision: number): void {
  if (state.status === "settled") return;
  state.status = "settled";
  state.result = { status: "cancelled", revision };
  applyStateStore.notify();
  for (const waiter of state.waiters.splice(0)) waiter(state.result);
}

function settlePersistenceRejected(
  state: GenerationApplyState,
  revision: number,
): void {
  state.abort.abort();
  state.status = "settled";
  const result: SourceResult = {
    status: "rejected",
    revision,
    error: new RuntimeError("metadata_apply_failed", "预览未能保存，请重试。"),
  };
  state.result = result;
  applyStateStore.notify();
  for (const waiter of state.waiters.splice(0)) waiter(result);
}

function abortIncompleteGenerations(controller: BundlePreviewController): void {
  const runtime = controller.getActiveRuntime();
  const revision = runtime ? runtime.getSnapshot().revision : 0;
  for (const state of applyStateStore.abortIncomplete()) {
    settleCancelled(state, revision);
  }
}

/**
 * 等待某 generation 的 applySource 结果（已 settle 则立即返回）。
 *
 * `await_apply_result` 必须永远完成：如果协议顺序损坏、浏览器刷新或
 * generationId 不存在，不能留下无限轮询和未解决 interrupt；立即按
 * cancelled 返回，由上层转换成 fail-closed 的 aborted。
 */
export function waitApplyResult(
  generationId: string,
  runtime: NextAppRuntime | null,
): Promise<SourceResult> {
  const state = applyStateStore.get(generationId);
  if (state?.status === "settled" && state.result) {
    return Promise.resolve(state.result);
  }
  if (state?.status === "streaming") {
    return new Promise((resolve) => state.waiters.push(resolve));
  }
  const revision = runtime ? runtime.getSnapshot().revision : 0;
  console.warn(
    `[apply-controller] missing generation for await_apply_result generation=${generationId}`,
  );
  return Promise.resolve({ status: "cancelled", revision });
}
function boundedErrorSummary(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "unknown";
  const message =
    typeof candidate.message === "string"
      ? candidate.message.replaceAll(/\s+/g, " ").slice(0, 300)
      : "";
  return `${code}${message ? `: ${message}` : ""}`;
}

export function RuntimeApplyController(props: {
  agentId: string;
  appId: string;
  controller: BundlePreviewController;
}) {
  const { agent, isReady } = useAgent({ agentId: props.agentId });
  const controller = props.controller;

  // StrictMode 双挂载防护：effect 内创建/清理订阅即可，状态按 generationId 关联。
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const appIdRef = useRef(props.appId);
  appIdRef.current = props.appId;

  // S3 心跳（设计 §9）：生成流式进行中每 10s 续租；服务端心跳超时
  // 扫描将无心跳的开放 run 标记 incomplete（不恢复、不重放）。
  useEffect(() => {
    const timer = setInterval(() => {
      const appId = appIdRef.current;
      for (const generationId of applyStateStore.streamingGenerationIds()) {
        void fetch(
          `/api/apps/${encodeURIComponent(appId)}/generation/heartbeat`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            // generation 路由在 v2 下与 Preview Commit 一样要求显式版本；
            // 心跳缺失版本会被拒绝，使长时间生成无法续租。
            body: JSON.stringify({ generationId, protocolVersion: 2 }),
          },
        ).catch(() => {
          /* 心跳失败不中断前端流程；超时由服务端扫描兜底 */
        });
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.type !== "CUSTOM") return;
        const { name, value } = event as unknown as {
          name: string;
          value?: { generationId?: string; text?: string; error?: string };
        };
        const generationId = value?.generationId;
        if (!generationId) return;
        const activeRuntimeOf = () => controllerRef.current.getActiveRuntime();

        if (name === "spec.patch.persistence_rejected") {
          const state = applyStateStore.get(generationId);
          if (state) {
            const activeRuntime = controllerRef.current.getActiveRuntime();
            settlePersistenceRejected(
              state,
              activeRuntime ? activeRuntime.getSnapshot().revision : 0,
            );
            patchLogStore.append(
              generationId,
              "[error] 预览未能保存，请重试。\n",
            );
          }
          return;
        }

        if (name === "spec.patch.start") {
          // 陈旧 generation 防护：同 id 已存在则忽略。
          if (applyStateStore.get(generationId)) return;
          const abort = new AbortController();
          const currentRuntime = activeRuntimeOf();
          const base =
            currentRuntime && currentRuntime.getSnapshot().current
              ? ("current" as const)
              : ("empty" as const);
          const state: GenerationApplyState = {
            generationId,
            status: "streaming",
            abort,
            base,
            chunks: [],
            waiters: [],
            writerClosed: false,
          };
          applyStateStore.upsert(state);
          return;
        }

        const state = applyStateStore.get(generationId);
        if (!state || state.status !== "streaming") return; // 陈旧事件忽略

        if (name === "spec.patch.delta") {
          const text = value?.text ?? "";
          state.chunks.push(text);
          patchLogStore.append(generationId, text);
          return;
        }

        if (name === "spec.patch.finish") {
          state.writerClosed = true;
          if (state.abort.signal.aborted) {
            const rt0 = activeRuntimeOf();
            settleCancelled(state, rt0 ? rt0.getSnapshot().revision : 0);
            return;
          }

          const finishValue = value as
            | {
                generationId?: string;
                operationCount?: number;
                candidateDigest?: string;
                uiBundleDigest?: string;
                reportDigest?: string;
                bundle?: unknown;
                publishBlocked?: boolean;
                fatalVisualIssues?: unknown[];
              }
            | undefined;

          // S11：优先使用服务端发送的权威 Bundle 进行原子事务提交。
          // bundle 已在服务端 Candidate→Validation 后冻结；客户端只负责渲染
          // 以及携带 digest 请求 Preview Commit，绝不上传 Spec/patch 作为事实。
          const authoritativeFinish =
            finishValue?.bundle &&
            finishValue.candidateDigest &&
            finishValue.uiBundleDigest &&
            finishValue.reportDigest
              ? {
                  bundle: finishValue.bundle,
                  candidateDigest: finishValue.candidateDigest,
                  uiBundleDigest: finishValue.uiBundleDigest,
                  reportDigest: finishValue.reportDigest,
                }
              : null;
          let stagedBundleRevision: number | undefined;
          const stagePromise: Promise<SourceResult> =
            authoritativeFinish !== null
              ? controllerRef.current
                  .stageBundle({
                    generationId,
                    bundle: authoritativeFinish.bundle,
                    expected: {
                      candidateDigest: authoritativeFinish.candidateDigest,
                      uiBundleDigest: authoritativeFinish.uiBundleDigest,
                      reportDigest: authoritativeFinish.reportDigest,
                    },
                    signal: state.abort.signal,
                  })
                  .then((outcome) => {
                    const active = activeRuntimeOf();
                    if (outcome.status === "committed") {
                      stagedBundleRevision = outcome.bundleRevision;
                      return {
                        status: "committed" as const,
                        revision: outcome.runtimeRevision,
                        spec: active
                          ? active.getSnapshot().current!
                          : ({} as never),
                      };
                    }
                    if (outcome.status === "failed") {
                      return {
                        status: "rejected" as const,
                        revision: active ? active.getSnapshot().revision : 0,
                        error: new RuntimeError(
                          "preview_staging_failed",
                          outcome.code,
                        ),
                      };
                    }
                    return {
                      status: "cancelled" as const,
                      revision: active ? active.getSnapshot().revision : 0,
                    };
                  })
              : controllerRef.current.stageGenerationPatch({
                  generationId,
                  base: state.base,
                  patchText: state.chunks.join(""),
                  signal: state.abort.signal,
                });

          void stagePromise
            .then(async (initialResult: SourceResult) => {
              let result = initialResult;
              // v2 Preview Commit 是用户可见“已更新”的必要条件：本地 staging
              // 成功但服务端拒绝/网络中断时保持 unsaved，不能向聊天层报告成功。
              if (
                authoritativeFinish !== null &&
                result.status === "committed" &&
                authoritativeFinish &&
                stagedBundleRevision !== undefined
              ) {
                const appId = appIdRef.current;
                try {
                  const response = await fetch(
                    `/api/apps/${encodeURIComponent(appId)}/preview-commit`,
                    {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        generationId,
                        candidateDigest: authoritativeFinish.candidateDigest,
                        uiBundleDigest: authoritativeFinish.uiBundleDigest,
                        reportDigest: authoritativeFinish.reportDigest,
                        protocolVersion: 2,
                      }),
                    },
                  );
                  if (!response.ok) {
                    throw new Error(`preview_commit_${response.status}`);
                  }
                  const committed = (await response.json()) as {
                    draftVersionId?: string;
                  };
                  if (!committed.draftVersionId) {
                    throw new Error("preview_commit_missing_draft");
                  }
                  const confirmed = controllerRef.current.confirmDraftCommitted({
                    appId,
                    candidateDigest: authoritativeFinish.candidateDigest,
                    bundleRevision: stagedBundleRevision,
                    draftId: committed.draftVersionId,
                  });
                  if (!confirmed.ok) {
                    throw new Error(`preview_commit_confirmation_${confirmed.code}`);
                  }
                } catch (cause) {
                  result = {
                    status: "rejected",
                    revision: result.revision,
                    error: new RuntimeError(
                      "preview_staging_failed",
                      "预览已暂存但未能保存为草稿",
                    ),
                  };
                  void cause;
                }
              }
              console.warn(
                `[apply-controller] settled generation=${generationId} status=${result.status} revision=${result.revision} error=${boundedErrorSummary(result.status === "rejected" ? result.error : undefined)}`,
              );
              state.status = "settled";
              state.result = result;
              applyStateStore.notify();
              for (const waiter of state.waiters.splice(0)) waiter(result);

            })
            .catch((cause: unknown) => {
              console.warn(
                `[apply-controller] staging threw generation=${generationId} error=${boundedErrorSummary(cause)}`,
              );
              const rt1 = activeRuntimeOf();
              state.status = "settled";
              state.result = {
                status: "cancelled",
                revision: rt1 ? rt1.getSnapshot().revision : 0,
              };
              applyStateStore.notify();
              const fallback = state.result;
              for (const waiter of state.waiters.splice(0)) waiter(fallback);
              void cause;
            });
          return;
        }

        if (name === "spec.patch.error") {
          state.abort.abort();
          const rt2 = activeRuntimeOf();
          settleCancelled(state, rt2 ? rt2.getSnapshot().revision : 0);
          patchLogStore.append(
            generationId,
            `[error] ${value?.error ?? "unknown"}\n`,
          );
        }
      },
      onRunFailed: () => {
        // 停止按钮/传输中止：只中止补丁流未完成的 generation；
        // 已收到 finish 的允许候选事务正常收尾（数据完整）。
        abortIncompleteGenerations(controllerRef.current);
      },
      onRunFinishedEvent: () => {
        // 用户停止时 runner 以 stopRequested 语义补 RUN_FINISHED（正常
        // 终止事件，不会触发 onRunFailed）。此时仍未收到 finish 的
        // generation 永远不会完成了——中止它们让卡片落定“更新失败”。
        // 正常流程下 finish 先于 RUN_FINISHED 到达（writerClosed=true），
        // 不会误伤。
        abortIncompleteGenerations(controllerRef.current);
      },
      onRunErrorEvent: () => {
        abortIncompleteGenerations(controllerRef.current);
      },
      onRunFinalized: () => {
        // 停止按钮的唯一可靠信号：CopilotKit 客户端停止会中止本地 fetch，
        // 之后不再有任何流事件（无 onRunFinished/onRunFailed），只有
        // onRunFinalized 会触发。正常 run 结束时它也会触发，但
        // abortIncomplete 只中止 writer 未关闭的 generation，不误伤。
        const latest = getLatestApplyState();
        console.warn(
          `[apply-controller] onRunFinalized latest=${latest?.generationId ?? "none"} status=${latest?.status ?? "none"} writerClosed=${latest?.writerClosed ?? false}`,
        );
        abortIncompleteGenerations(controllerRef.current);
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, isReady]);

  // 供工具卡订阅状态（useSyncExternalStore 需要一个稳定的 getSnapshot）。
  useSyncExternalStore(
    subscribeApplyStates,
    () => 0,
    () => 0,
  );
  return null;
}
