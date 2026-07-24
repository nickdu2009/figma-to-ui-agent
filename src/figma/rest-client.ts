import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import {
  assertFigmaFileKey,
  normalizeFigmaNodeId,
} from "./url.ts";

const FIGMA_API_ROOT = new URL("https://api.figma.com/v1/");
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_MAX_AUTO_RETRY_AFTER_MS = 5 * 60_000;
const MAX_REQUEST_URL_LENGTH = 8_192;
const MAX_BACKOFF_DELAY_MS = 30_000;

type FigmaEndpoint =
  | "file"
  | "nodes"
  | "image_renders"
  | "image_fills"
  | "variables";

export interface FigmaRateLimitLogEvent {
  endpoint: FigmaEndpoint;
  status: 429;
  attempt: number;
  retryAfterSeconds?: string;
  planTier?: string;
  rateLimitType?: string;
  upgradeLinkPresent: boolean;
  retryDelayMs: number;
  autoRetry: boolean;
  message: string;
}

const LIVE_ENDPOINT_MIN_INTERVAL_MS: Record<FigmaEndpoint, number> = {
  file: 6_500,
  nodes: 6_500,
  image_renders: 6_500,
  image_fills: 2_500,
  variables: 2_500,
};
const TEST_ENDPOINT_MIN_INTERVAL_MS: Record<FigmaEndpoint, number> = {
  file: 0,
  nodes: 0,
  image_renders: 0,
  image_fills: 0,
  variables: 0,
};

const jsonObjectSchema = z.record(z.string(), z.unknown());

export type FigmaRestErrorCode =
  | "invalid_configuration"
  | "request_url_too_long"
  | "aborted"
  | "timeout"
  | "network_error"
  | "redirect_forbidden"
  | "http_error"
  | "response_too_large"
  | "invalid_content_type"
  | "invalid_json"
  | "invalid_response_shape";

export class FigmaRestError extends Error {
  readonly code: FigmaRestErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: FigmaRestErrorCode,
    message: string,
    options: {
      status?: number;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "FigmaRestError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export type FigmaFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FigmaRestClientOptions {
  token: string;
  fetchImpl?: FigmaFetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRetries?: number;
  maxAutoRetryAfterMs?: number;
  minIntervalMsByEndpoint?: Partial<Record<FigmaEndpoint, number>>;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  rateLimitLogger?: (event: FigmaRateLimitLogEvent) => void;
}

export interface FigmaImageRenderOptions {
  format?: "png" | "jpg";
  scale?: number;
  signal?: AbortSignal;
}

function assertPositiveInteger(
  value: number,
  name: string,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new FigmaRestError(
      "invalid_configuration",
      `${name} 配置无效`,
    );
  }
  return value;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  return Math.max(timestamp - Date.now(), 0);
}

function retryDelayMilliseconds(
  response: Response,
  retryIndex: number,
): number {
  return (
    parseRetryAfter(response.headers.get("retry-after")) ??
    Math.min(250 * 2 ** retryIndex, MAX_BACKOFF_DELAY_MS)
  );
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function sanitizeRateLimitHeader(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function rateLimitDiagnostic(response: Response): string {
  if (response.status !== 429) {
    return "";
  }
  const retryAfterSeconds = sanitizeRateLimitHeader(
    response.headers.get("retry-after"),
  );
  const planTier = sanitizeRateLimitHeader(
    response.headers.get("x-figma-plan-tier"),
  );
  const rateLimitType = sanitizeRateLimitHeader(
    response.headers.get("x-figma-rate-limit-type"),
  );
  const upgradeLinkPresent = response.headers.has(
    "x-figma-upgrade-link",
  );
  const parts = [
    retryAfterSeconds
      ? `retryAfterSeconds=${retryAfterSeconds}`
      : undefined,
    planTier ? `planTier=${planTier}` : undefined,
    rateLimitType ? `rateLimitType=${rateLimitType}` : undefined,
    upgradeLinkPresent ? "upgradeLinkPresent=true" : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function rateLimitLogEvent(
  endpoint: FigmaEndpoint,
  response: Response,
  retryDelayMs: number,
  attempt: number,
  autoRetry: boolean,
): FigmaRateLimitLogEvent {
  return {
    endpoint,
    status: 429,
    attempt,
    retryAfterSeconds: sanitizeRateLimitHeader(
      response.headers.get("retry-after"),
    ),
    planTier: sanitizeRateLimitHeader(
      response.headers.get("x-figma-plan-tier"),
    ),
    rateLimitType: sanitizeRateLimitHeader(
      response.headers.get("x-figma-rate-limit-type"),
    ),
    upgradeLinkPresent: response.headers.has(
      "x-figma-upgrade-link",
    ),
    retryDelayMs,
    autoRetry,
    message: autoRetry
      ? "Figma REST 触发 429，本地按 Retry-After 等待后重试"
      : "Figma REST 触发 429，本地停止自动重试",
  };
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > maximumBytes
  ) {
    await response.body?.cancel();
    throw new FigmaRestError(
      "response_too_large",
      "Figma REST 响应超过大小上限",
    );
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteCount += value.byteLength;
      if (byteCount > maximumBytes) {
        await reader.cancel();
        throw new FigmaRestError(
          "response_too_large",
          "Figma REST 响应超过大小上限",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function createAttemptSignal(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, {
    once: true,
  });
  if (externalSignal?.aborted) {
    controller.abort();
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

export class FigmaRestClient {
  private readonly token: string;
  private readonly fetchImpl: FigmaFetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxRetries: number;
  private readonly maxAutoRetryAfterMs: number;
  private readonly minIntervalMsByEndpoint: Record<
    FigmaEndpoint,
    number
  >;
  private readonly now: () => number;
  private readonly sleep: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly rateLimitLogger: (
    event: FigmaRateLimitLogEvent,
  ) => void;
  private readonly nextRequestAt = new Map<FigmaEndpoint, number>();
  private rateLimitBlockedUntil = 0;

  constructor(options: FigmaRestClientOptions) {
    if (
      options.token.length < 1 ||
      options.token.length > 4_096 ||
      /[\r\n]/.test(options.token)
    ) {
      throw new FigmaRestError(
        "invalid_configuration",
        "Figma Token 配置无效",
      );
    }
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = assertPositiveInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
      120_000,
    );
    this.maxResponseBytes = assertPositiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
      100 * 1024 * 1024,
    );
    this.maxAutoRetryAfterMs = assertPositiveInteger(
      options.maxAutoRetryAfterMs ?? DEFAULT_MAX_AUTO_RETRY_AFTER_MS,
      "maxAutoRetryAfterMs",
      24 * 60 * 60 * 1_000,
    );
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
      throw new FigmaRestError(
        "invalid_configuration",
        "maxRetries 配置无效",
      );
    }
    this.maxRetries = maxRetries;
    const defaultIntervals = options.fetchImpl
      ? TEST_ENDPOINT_MIN_INTERVAL_MS
      : LIVE_ENDPOINT_MIN_INTERVAL_MS;
    this.minIntervalMsByEndpoint = {
      ...defaultIntervals,
      ...options.minIntervalMsByEndpoint,
    };
    for (const [endpoint, value] of Object.entries(
      this.minIntervalMsByEndpoint,
    )) {
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value > 60_000
      ) {
        throw new FigmaRestError(
          "invalid_configuration",
          `${endpoint} 限流间隔配置无效`,
        );
      }
    }
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ??
      ((milliseconds, signal) =>
        delay(milliseconds, undefined, { signal }));
    this.rateLimitLogger =
      options.rateLimitLogger ??
      ((event) => {
        console.warn(`[figma-rest] ${JSON.stringify(event)}`);
      });
  }

  async getFile(
    fileKeyInput: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const fileKey = assertFigmaFileKey(fileKeyInput);
    return await this.requestJson(
      "file",
      this.buildUrl(`files/${encodeURIComponent(fileKey)}`),
      signal,
    );
  }

  async getNodes(
    fileKeyInput: string,
    nodeIdsInput: readonly string[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const fileKey = assertFigmaFileKey(fileKeyInput);
    if (nodeIdsInput.length < 1 || nodeIdsInput.length > 100) {
      throw new FigmaRestError(
        "invalid_configuration",
        "节点请求数量必须在 1 到 100 之间",
      );
    }
    const nodeIds = [
      ...new Set(nodeIdsInput.map(normalizeFigmaNodeId)),
    ];
    const url = this.buildUrl(
      `files/${encodeURIComponent(fileKey)}/nodes`,
    );
    url.searchParams.set("ids", nodeIds.join(","));
    this.assertRequestUrlLength(url);
    return await this.requestJson("nodes", url, signal);
  }

  async getImageRenders(
    fileKeyInput: string,
    nodeIdsInput: readonly string[],
    options: FigmaImageRenderOptions = {},
  ): Promise<Record<string, unknown>> {
    const fileKey = assertFigmaFileKey(fileKeyInput);
    if (nodeIdsInput.length < 1 || nodeIdsInput.length > 100) {
      throw new FigmaRestError(
        "invalid_configuration",
        "截图节点数量必须在 1 到 100 之间",
      );
    }
    const nodeIds = [
      ...new Set(nodeIdsInput.map(normalizeFigmaNodeId)),
    ];
    const scale = options.scale ?? 1;
    if (!Number.isFinite(scale) || scale < 0.01 || scale > 4) {
      throw new FigmaRestError(
        "invalid_configuration",
        "截图 scale 配置无效",
      );
    }
    const url = this.buildUrl(
      `images/${encodeURIComponent(fileKey)}`,
    );
    url.searchParams.set("ids", nodeIds.join(","));
    url.searchParams.set("format", options.format ?? "png");
    url.searchParams.set("scale", String(scale));
    this.assertRequestUrlLength(url);
    return await this.requestJson(
      "image_renders",
      url,
      options.signal,
    );
  }

  async getImageFills(
    fileKeyInput: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const fileKey = assertFigmaFileKey(fileKeyInput);
    return await this.requestJson(
      "image_fills",
      this.buildUrl(
        `files/${encodeURIComponent(fileKey)}/images`,
      ),
      signal,
    );
  }

  async getLocalVariables(
    fileKeyInput: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const fileKey = assertFigmaFileKey(fileKeyInput);
    return await this.requestJson(
      "variables",
      this.buildUrl(
        `files/${encodeURIComponent(fileKey)}/variables/local`,
      ),
      signal,
    );
  }

  private buildUrl(relativePath: string): URL {
    const url = new URL(relativePath, FIGMA_API_ROOT);
    if (
      url.protocol !== FIGMA_API_ROOT.protocol ||
      url.host !== FIGMA_API_ROOT.host ||
      !url.pathname.startsWith(FIGMA_API_ROOT.pathname)
    ) {
      throw new FigmaRestError(
        "invalid_configuration",
        "Figma API 路径无效",
      );
    }
    this.assertRequestUrlLength(url);
    return url;
  }

  private assertRequestUrlLength(url: URL): void {
    if (url.href.length > MAX_REQUEST_URL_LENGTH) {
      throw new FigmaRestError(
        "request_url_too_long",
        "Figma REST 请求 URL 超过长度上限",
      );
    }
  }

  private async requestJson(
    endpoint: FigmaEndpoint,
    url: URL,
    externalSignal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForClientRateLimit(endpoint, externalSignal);
      const attemptSignal = createAttemptSignal(
        externalSignal,
        this.timeoutMs,
      );
      try {
        let response: Response;
        try {
          response = await this.fetchImpl(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "X-Figma-Token": this.token,
            },
            redirect: "manual",
            signal: attemptSignal.signal,
          });
        } catch {
          if (externalSignal?.aborted) {
            throw new FigmaRestError(
              "aborted",
              `Figma REST ${endpoint} 请求已取消`,
            );
          }
          if (attemptSignal.didTimeout()) {
            throw new FigmaRestError(
              "timeout",
              `Figma REST ${endpoint} 请求超时`,
              { retryable: true },
            );
          }
          throw new FigmaRestError(
            "network_error",
            `Figma REST ${endpoint} 网络请求失败`,
            { retryable: true },
          );
        }

        if (response.status >= 300 && response.status <= 399) {
          await response.body?.cancel();
          throw new FigmaRestError(
            "redirect_forbidden",
            `Figma REST ${endpoint} 拒绝重定向`,
            { status: response.status },
          );
        }

        if (!response.ok) {
          const retryable = shouldRetryStatus(response.status);
          if (retryable && attempt < this.maxRetries) {
            const retryDelay = retryDelayMilliseconds(response, attempt);
            const autoRetry = retryDelay <= this.maxAutoRetryAfterMs;
            if (response.status === 429) {
              this.noteRateLimited(retryDelay);
              this.logRateLimit(
                endpoint,
                response,
                retryDelay,
                attempt + 1,
                autoRetry,
              );
            }
            await response.body?.cancel();
            if (!autoRetry) {
              throw new FigmaRestError(
                "http_error",
                `Figma REST ${endpoint} 返回 HTTP ${
                  response.status
                }${rateLimitDiagnostic(response)}，超过本地自动等待上限`,
                { status: response.status, retryable },
              );
            }
            try {
              await this.sleep(retryDelay, externalSignal);
            } catch {
              throw new FigmaRestError(
                "aborted",
                `Figma REST ${endpoint} 重试等待已取消`,
              );
            }
            continue;
          }
          await response.body?.cancel();
          if (response.status === 429) {
            const retryDelay = retryDelayMilliseconds(response, attempt);
            this.noteRateLimited(retryDelay);
            this.logRateLimit(
              endpoint,
              response,
              retryDelay,
              attempt + 1,
              false,
            );
          }
          throw new FigmaRestError(
            "http_error",
            `Figma REST ${endpoint} 返回 HTTP ${
              response.status
            }${rateLimitDiagnostic(response)}`,
            { status: response.status, retryable },
          );
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (
          !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(
            contentType,
          )
        ) {
          await response.body?.cancel();
          throw new FigmaRestError(
            "invalid_content_type",
            `Figma REST ${endpoint} 返回非 JSON 内容`,
          );
        }

        let bytes: Uint8Array;
        try {
          bytes = await readBoundedBody(
            response,
            this.maxResponseBytes,
          );
        } catch (error) {
          if (error instanceof FigmaRestError) {
            throw error;
          }
          if (externalSignal?.aborted) {
            throw new FigmaRestError(
              "aborted",
              `Figma REST ${endpoint} 响应读取已取消`,
            );
          }
          if (attemptSignal.didTimeout()) {
            throw new FigmaRestError(
              "timeout",
              `Figma REST ${endpoint} 响应读取超时`,
              { retryable: true },
            );
          }
          throw new FigmaRestError(
            "network_error",
            `Figma REST ${endpoint} 响应读取失败`,
            { retryable: true },
          );
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
        } catch {
          throw new FigmaRestError(
            "invalid_json",
            `Figma REST ${endpoint} 返回无效 JSON`,
          );
        }
        const result = jsonObjectSchema.safeParse(parsed);
        if (!result.success) {
          throw new FigmaRestError(
            "invalid_response_shape",
            `Figma REST ${endpoint} 返回结构无效`,
          );
        }
        return result.data;
      } finally {
        attemptSignal.cleanup();
      }
    }

    throw new FigmaRestError(
      "network_error",
      `Figma REST ${endpoint} 请求失败`,
    );
  }

  private noteRateLimited(retryDelayMs: number): void {
    this.rateLimitBlockedUntil = Math.max(
      this.rateLimitBlockedUntil,
      this.now() + retryDelayMs,
    );
  }

  private logRateLimit(
    endpoint: FigmaEndpoint,
    response: Response,
    retryDelayMs: number,
    attempt: number,
    autoRetry: boolean,
  ): void {
    try {
      this.rateLimitLogger(
        rateLimitLogEvent(
          endpoint,
          response,
          retryDelayMs,
          attempt,
          autoRetry,
        ),
      );
    } catch {
      // 429 日志失败不能影响主请求路径。
    }
  }

  private async waitForClientRateLimit(
    endpoint: FigmaEndpoint,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw new FigmaRestError(
        "aborted",
        `Figma REST ${endpoint} 限流等待已取消`,
      );
    }
    const now = this.now();
    const retryAfterWait = Math.max(this.rateLimitBlockedUntil - now, 0);
    if (retryAfterWait > this.maxAutoRetryAfterMs) {
      throw new FigmaRestError(
        "http_error",
        `Figma REST ${endpoint} 本地限流中 (retryAfterSeconds=${Math.ceil(
          retryAfterWait / 1_000,
        )})`,
        { status: 429, retryable: true },
      );
    }
    const intervalWait = Math.max(
      (this.nextRequestAt.get(endpoint) ?? 0) - now,
      0,
    );
    const waitMs = Math.max(retryAfterWait, intervalWait);
    if (waitMs > 0) {
      try {
        await this.sleep(waitMs, signal);
      } catch {
        throw new FigmaRestError(
          "aborted",
          `Figma REST ${endpoint} 限流等待已取消`,
        );
      }
    }
    this.nextRequestAt.set(
      endpoint,
      this.now() + this.minIntervalMsByEndpoint[endpoint],
    );
  }
}
