/**
 * 受控模型策略与 LiteLLM 接入契约（设计 §4.1，计划 S10 动作 1/2/4/5/7）。
 *
 * 核心不变式：
 * 1. 生产固定 Chat=gpt-5.6-terra/medium、Spec=gpt-5.6-sol/high、repair=xhigh；
 * 2. 客户端请求、用户消息、前端工具参数均不能覆盖模型/provider/endpoint/reasoning/retry；
 * 3. 统一使用 @mastra/core 的 OpenAICompatibleConfig 指向 LiteLLM；
 * 4. maxRetries: 1 只放 Agent 构造器顶层，禁止跨模型或跨 provider 降级；
 * 5. 错误/日志只输出 allowlist 字段与稳定码，严格脱敏。
 */
import type { OpenAICompatibleConfig } from "@mastra/core/llm";

export type { OpenAICompatibleConfig };

export const LITELLM_PROVIDER_ID = "litellm" as const;

/** 生产固定模型与推理强度。 */
export const PRODUCTION_MODEL_POLICY = {
  chat: {
    modelId: "gpt-5.6-terra",
    reasoningEffort: "medium" as const,
    maxSteps: 12,
    maxRetries: 1,
  },
  spec: {
    modelId: "gpt-5.6-sol",
    reasoningEffort: "high" as const,
    maxRetries: 1,
  },
  repair: {
    modelId: "gpt-5.6-sol",
    reasoningEffort: "xhigh" as const,
    maxRetries: 1,
  },
} as const;

export type ReasoningEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface LiteLlmServerConfig {
  baseUrl: string;
  apiKey: string;
}

/** 从进程环境解析 LiteLLM 服务端凭据（不向客户端暴露）。 */
export function resolveLiteLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
): LiteLlmServerConfig {
  const apiKey =
    env.LITELLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || "";
  const baseUrl =
    env.VMA_LITELLM_BASE_URL?.trim() ||
    env.VMA_OPENAI_BASE_URL?.trim() ||
    "http://127.0.0.1:4000/v1";
  return { baseUrl, apiKey };
}

export interface LiteLlmModelConfig {
  providerId: typeof LITELLM_PROVIDER_ID;
  modelId: string;
  url: string;
  apiKey: string;
}

/** 构造 @mastra/core 原生 OpenAICompatibleConfig。 */
export function createLiteLlmModelConfig(
  modelId: string,
  config: LiteLlmServerConfig = resolveLiteLlmConfig(),
): LiteLlmModelConfig {
  return {
    providerId: LITELLM_PROVIDER_ID,
    modelId,
    url: config.baseUrl,
    apiKey: config.apiKey,
  };
}

/** 构造 providerOptions（键必须与 providerId="litellm" 一致）。 */
export function createLiteLlmExecutionOptions(
  reasoningEffort: ReasoningEffortLevel,
): { providerOptions: { litellm: { reasoningEffort: ReasoningEffortLevel } } } {
  return {
    providerOptions: {
      litellm: { reasoningEffort },
    },
  };
}

/**
 * 日志与错误安全白名单字段（设计 §4.1/§10）。
 * 禁止记录/返回原始 error 对象、stack、cause、headers、请求正文、模型上下文。
 */
export interface SafeModelLogEntry {
  requestId?: string;
  generationId?: string;
  agentId: string;
  modelAlias: string;
  attempt?: number;
  phase?: string;
  code: string;
  durationMs?: number;
}

/** 稳定模型错误码清单。 */
export const MODEL_ERROR_CODES = {
  UPSTREAM_ERROR: "model_upstream_error",
  RATE_LIMIT: "model_rate_limit",
  AUTH_ERROR: "model_auth_error",
  CONTEXT_LENGTH_EXCEEDED: "model_context_length_exceeded",
  TIMEOUT: "model_timeout",
  ABORTED: "model_aborted",
  NETWORK_ERROR: "model_network_error",
  UNKNOWN: "model_unknown_error",
} as const;

export type ModelErrorCode =
  (typeof MODEL_ERROR_CODES)[keyof typeof MODEL_ERROR_CODES];

/** 将 Mastra/LiteLLM/网络异常归一化为稳定安全错误码（不泄露上游细节）。 */
export function normalizeModelError(error: unknown): {
  code: ModelErrorCode;
  message: string;
} {
  if (!error) {
    return {
      code: MODEL_ERROR_CODES.UNKNOWN,
      message: "未知的模型调用错误",
    };
  }

  const err = error as {
    name?: string;
    message?: string;
    status?: number;
    statusCode?: number;
    code?: string;
  };

  const status = err.status ?? err.statusCode;
  const name = String(err.name ?? "");
  const msg = String(err.message ?? "");

  if (name === "AbortError" || msg.includes("aborted")) {
    return {
      code: MODEL_ERROR_CODES.ABORTED,
      message: "模型调用已终止",
    };
  }
  if (
    name === "TimeoutError" ||
    msg.includes("timeout") ||
    msg.includes("ETIMEDOUT")
  ) {
    return {
      code: MODEL_ERROR_CODES.TIMEOUT,
      message: "模型调用超时",
    };
  }
  if (
    status === 401 ||
    status === 403 ||
    msg.includes("unauthorized") ||
    msg.includes("API key")
  ) {
    return {
      code: MODEL_ERROR_CODES.AUTH_ERROR,
      message: "模型服务端鉴权失败",
    };
  }
  if (status === 429 || msg.includes("rate limit") || msg.includes("quota")) {
    return {
      code: MODEL_ERROR_CODES.RATE_LIMIT,
      message: "模型请求频次或配额超限",
    };
  }
  if (
    status === 400 &&
    (msg.includes("context_length") || msg.includes("maximum context length"))
  ) {
    return {
      code: MODEL_ERROR_CODES.CONTEXT_LENGTH_EXCEEDED,
      message: "模型上下文长度超限",
    };
  }
  if (status && status >= 500) {
    return {
      code: MODEL_ERROR_CODES.UPSTREAM_ERROR,
      message: "模型上游服务暂时不可用",
    };
  }
  if (
    err.code === "ECONNREFUSED" ||
    err.code === "ENOTFOUND" ||
    msg.includes("fetch failed")
  ) {
    return {
      code: MODEL_ERROR_CODES.NETWORK_ERROR,
      message: "无法连接到模型代理端点",
    };
  }

  return {
    code: MODEL_ERROR_CODES.UNKNOWN,
    message: "模型生成异常",
  };
}

/** 格式化安全日志条目（严格只输出 allowlist 字段）。 */
export function formatSafeModelLog(entry: SafeModelLogEntry): string {
  const parts: string[] = [
    `[model-log] agent=${entry.agentId} model=${entry.modelAlias} code=${entry.code}`,
  ];
  if (entry.requestId) parts.push(`requestId=${entry.requestId}`);
  if (entry.generationId) parts.push(`generationId=${entry.generationId}`);
  if (entry.phase) parts.push(`phase=${entry.phase}`);
  if (entry.attempt !== undefined) parts.push(`attempt=${entry.attempt}`);
  if (entry.durationMs !== undefined)
    parts.push(`durationMs=${entry.durationMs}`);
  return parts.join(" ");
}
