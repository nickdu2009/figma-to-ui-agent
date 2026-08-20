/**
 * 受控 Mastra Runtime 工厂与生命周期管理器（设计 §4.1，计划 S10 动作 3）。
 *
 * 核心不变式：
 * 1. Runtime 固定 `logger: false`（防止框架内部 ConsoleLogger 泄露请求体/密钥）；
 * 2. 禁止直接调用未注册的裸 `new Agent(...)`；
 * 3. 静态 Agent（如 chat）常驻注册；
 * 4. 动态 Spec/benchmark Agent 必须使用唯一 registryKey 注册，
 *    在完整消费流终态后于 finally 注销；
 * 5. 注册表设有动态容量上限（MAX_DYNAMIC_AGENTS），防止并发泄露。
 */
import type { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";

/** 动态 Agent 注册表容量上限。 */
export const MAX_DYNAMIC_AGENTS = 32;

export class AgentRegistryCapacityError extends Error {
  readonly code = "agent_registry_capacity_exceeded";
  constructor(activeCount: number, maxCapacity: number) {
    super(`动态 Agent 注册表容量超限：${activeCount} >= ${maxCapacity}`);
  }
}

/**
 * 受控流未能建立时的稳定失败。调用方不得降级为直接 Agent.stream()；否则会
 * 绕过动态注册表、容量限制与 finally 注销语义。
 */
export class ManagedAgentStreamError extends Error {
  readonly code = "managed_agent_stream_unavailable";
  constructor(message: string) {
    super(message);
  }
}

export interface ControlledAgentRuntimeOptions {
  staticAgents?: Record<string, Agent>;
  maxDynamicAgents?: number;
}

export class ControlledAgentRuntime {
  private readonly mastra: Mastra;
  private readonly staticKeys: Set<string>;
  private readonly dynamicKeys: Set<string>;
  private readonly maxDynamic: number;

  constructor(options: ControlledAgentRuntimeOptions = {}) {
    this.staticKeys = new Set(Object.keys(options.staticAgents ?? {}));
    this.dynamicKeys = new Set();
    this.maxDynamic = options.maxDynamicAgents ?? MAX_DYNAMIC_AGENTS;

    // logger: false 为核心日志安全边界
    this.mastra = new Mastra({
      agents: options.staticAgents ?? {},
      logger: false,
    });
  }

  /** 获取内部 Mastra 实例（仅供受控框架适配器访问）。 */
  get internalMastra(): Mastra {
    return this.mastra;
  }

  /** 获取已注册 Agent。 */
  getAgent(key: string): Agent | undefined {
    try {
      return this.mastra.getAgent(key);
    } catch {
      return undefined;
    }
  }

  /** 注册常驻静态 Agent。 */
  addStaticAgent(agent: Agent, key: string): void {
    if (this.dynamicKeys.has(key)) {
      throw new Error(`无法用静态 Agent 覆盖动态 Agent 键：${key}`);
    }
    this.mastra.addAgent(agent, key);
    this.staticKeys.add(key);
  }

  /** 注册动态 Agent（必须使用全局/run 唯一 key）。 */
  addDynamicAgent(agent: Agent, registryKey: string): void {
    if (this.staticKeys.has(registryKey)) {
      throw new Error(`无法覆盖静态 Agent 键：${registryKey}`);
    }
    if (this.dynamicKeys.has(registryKey)) {
      throw new Error(`动态 Agent 键已存在（禁止复用）：${registryKey}`);
    }
    if (this.dynamicKeys.size >= this.maxDynamic) {
      throw new AgentRegistryCapacityError(
        this.dynamicKeys.size,
        this.maxDynamic,
      );
    }
    this.mastra.addAgent(agent, registryKey);
    this.dynamicKeys.add(registryKey);
  }

  /** 注销动态 Agent。 */
  removeDynamicAgent(registryKey: string): boolean {
    if (this.staticKeys.has(registryKey)) {
      return false; // 静态 Agent 不可注销
    }
    if (!this.dynamicKeys.has(registryKey)) {
      return false;
    }
    this.dynamicKeys.delete(registryKey);
    return Boolean(this.mastra.removeAgent(registryKey));
  }

  /** 当前活跃动态 Agent 数量。 */
  get activeDynamicCount(): number {
    return this.dynamicKeys.size;
  }

  /** 获取所有活跃动态键快照。 */
  get dynamicAgentKeys(): string[] {
    return Array.from(this.dynamicKeys);
  }

  /** 获取所有静态键快照。 */
  get staticAgentKeys(): string[] {
    return Array.from(this.staticKeys);
  }

  /**
   * 托管执行动态 Agent：注册 → 执行回调（必须消费完毕） → finally 注销。
   * 确保无论成功/失败/异常，动态 Agent 绝不残留。
   */
  async withDynamicAgent<T>(
    agent: Agent,
    registryKey: string,
    execute: (registeredAgent: Agent) => Promise<T>,
  ): Promise<T> {
    this.addDynamicAgent(agent, registryKey);
    try {
      const registered = this.getAgent(registryKey);
      if (!registered) {
        throw new Error(`动态 Agent 注册后未找到：${registryKey}`);
      }
      return await execute(registered);
    } finally {
      this.removeDynamicAgent(registryKey);
    }
  }

  /**
   * 为一次动态调用创建受控 stream 入口。
   *
   * 动态 Agent 只会在 stream 被真正调用时注册；返回流的 fullStream 被消费至
   * done、throw 或 return 后立即注销。若调用方没有完整消费 fullStream，注册
   * 项会保持活跃并占用容量——这是一条刻意的 fail-closed 约束，而不是允许
   * 生成路径在后台泄漏未完成调用。
   */
  createManagedDynamicStreamAgent(agent: Agent, registryKey: string): Agent {
    let started = false;
    const runtime = this;

    return new Proxy(agent, {
      get(target, property, receiver) {
        if (property !== "stream") {
          return Reflect.get(target, property, receiver);
        }

        return (async (...args: unknown[]) => {
          if (started) {
            throw new ManagedAgentStreamError(
              `受控动态 Agent stream 不可重入：${registryKey}`,
            );
          }
          started = true;
          runtime.addDynamicAgent(target, registryKey);

          try {
            const registered = runtime.getAgent(registryKey);
            if (!registered) {
              throw new ManagedAgentStreamError(
                `动态 Agent 注册后未找到：${registryKey}`,
              );
            }
            const output = await (
              registered.stream as (...streamArgs: unknown[]) => Promise<unknown>
            ).apply(registered, args);
            const fullStream = (output as { fullStream?: unknown }).fullStream;
            if (!isAsyncIterable(fullStream)) {
              throw new ManagedAgentStreamError(
                `受控动态 Agent 未返回可消费的 fullStream：${registryKey}`,
              );
            }

            let finalized = false;
            const finalize = () => {
              if (finalized) return;
              finalized = true;
              runtime.removeDynamicAgent(registryKey);
            };

            // 保留 Mastra output 的其余属性/原型；仅把 fullStream 替换成能在
            // 消费终态执行 finally 的包装迭代器。
            return new Proxy(output as object, {
              get(outputTarget, outputProperty, outputReceiver) {
                if (outputProperty === "fullStream") {
                  return wrapAsyncIterable(fullStream, finalize);
                }
                return Reflect.get(outputTarget, outputProperty, outputReceiver);
              },
            });
          } catch (error) {
            runtime.removeDynamicAgent(registryKey);
            throw error;
          }
        }) as unknown as Agent["stream"];
      },
    }) as Agent;
  }

  /** 清理所有动态 Agent。 */
  dispose(): void {
    for (const key of Array.from(this.dynamicKeys)) {
      this.removeDynamicAgent(key);
    }
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
      typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
        "function",
  );
}

function wrapAsyncIterable(
  source: AsyncIterable<unknown>,
  finalize: () => void,
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      try {
        for await (const chunk of source) {
          yield chunk;
        }
      } finally {
        finalize();
      }
    },
  };
}

/** 创建生产受控 Agent Runtime。 */
export function createControlledAgentRuntime(
  options: ControlledAgentRuntimeOptions = {},
): ControlledAgentRuntime {
  return new ControlledAgentRuntime(options);
}
