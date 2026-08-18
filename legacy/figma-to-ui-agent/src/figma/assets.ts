import { isIP } from "node:net";

import type { LocalImageRef } from "../design-bundle/schema.ts";
import {
  ImageFormatError,
  inspectImageBytes,
  type SupportedImageMime,
} from "../media/image-format.ts";
import { ProjectStore } from "../project-store/store.ts";
import type { FigmaFetch } from "./rest-client.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_REMOTE_URL_LENGTH = 4_096;
const MAX_DOWNLOAD_ITEMS = 10_000;
const ALLOWED_IMAGE_HOST_SUFFIXES = [
  "figma.com",
  "figmausercontent.com",
  "amazonaws.com",
  "cloudfront.net",
] as const;

export type FigmaAssetErrorCode =
  | "invalid_configuration"
  | "invalid_source_ref"
  | "invalid_image_url"
  | "aborted"
  | "timeout"
  | "network_error"
  | "redirect_forbidden"
  | "http_error"
  | "image_too_large"
  | "invalid_content_type"
  | "format_mismatch"
  | "invalid_image";

export class FigmaAssetError extends Error {
  readonly code: FigmaAssetErrorCode;
  readonly status?: number;

  constructor(
    code: FigmaAssetErrorCode,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "FigmaAssetError";
    this.code = code;
    this.status = status;
  }
}

export interface FigmaRemoteImage {
  sourceRef: string;
  url: string;
  kind: "assets" | "screenshots";
}

export interface FigmaImageDownloaderOptions {
  projectStore: ProjectStore;
  fetchImpl?: FigmaFetch;
  timeoutMs?: number;
  maxImageBytes?: number;
  maxConcurrency?: number;
}

function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new FigmaAssetError(
      "invalid_configuration",
      `${name} 配置无效`,
    );
  }
  return value;
}

function isAllowedImageHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return ALLOWED_IMAGE_HOST_SUFFIXES.some(
    (suffix) =>
      normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

export function parseFigmaImageUrl(value: string): URL {
  if (value.length < 1 || value.length > MAX_REMOTE_URL_LENGTH) {
    throw new FigmaAssetError(
      "invalid_image_url",
      "Figma 图片 URL 长度无效",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FigmaAssetError(
      "invalid_image_url",
      "Figma 图片 URL 无效",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hash ||
    isIP(url.hostname) !== 0 ||
    !isAllowedImageHost(url.hostname)
  ) {
    throw new FigmaAssetError(
      "invalid_image_url",
      "Figma 图片 URL 不满足安全策略",
    );
  }
  return url;
}

function normalizedContentType(
  response: Response,
): SupportedImageMime | undefined {
  const value = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();
  if (
    value === "image/png" ||
    value === "image/jpeg" ||
    value === "image/webp"
  ) {
    return value;
  }
  return undefined;
}

function createDownloadSignal(
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
  const abort = () => controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  if (externalSignal?.aborted) {
    controller.abort();
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    },
  };
}

async function readBoundedImage(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > maximumBytes
  ) {
    await response.body?.cancel();
    throw new FigmaAssetError(
      "image_too_large",
      "Figma 图片超过大小上限",
    );
  }
  if (!response.body) {
    throw new FigmaAssetError("invalid_image", "Figma 图片响应为空");
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
        throw new FigmaAssetError(
          "image_too_large",
          "Figma 图片超过大小上限",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteCount < 1) {
    throw new FigmaAssetError("invalid_image", "Figma 图片响应为空");
  }
  const result = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function combineAbortSignals(
  first: AbortSignal | undefined,
  second: AbortSignal,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  first?.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  if (first?.aborted || second.aborted) {
    controller.abort();
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      first?.removeEventListener("abort", abort);
      second.removeEventListener("abort", abort);
    },
  };
}

export class FigmaImageDownloader {
  private readonly projectStore: ProjectStore;
  private readonly fetchImpl: FigmaFetch;
  private readonly timeoutMs: number;
  private readonly maxImageBytes: number;
  private readonly maxConcurrency: number;

  constructor(options: FigmaImageDownloaderOptions) {
    this.projectStore = options.projectStore;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = assertIntegerInRange(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      1,
      120_000,
      "timeoutMs",
    );
    this.maxImageBytes = assertIntegerInRange(
      options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
      1,
      100 * 1024 * 1024,
      "maxImageBytes",
    );
    this.maxConcurrency = assertIntegerInRange(
      options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      1,
      4,
      "maxConcurrency",
    );
  }

  async downloadAll(
    projectId: string,
    requests: readonly FigmaRemoteImage[],
    externalSignal?: AbortSignal,
  ): Promise<Map<string, LocalImageRef>> {
    if (requests.length > MAX_DOWNLOAD_ITEMS) {
      throw new FigmaAssetError(
        "invalid_configuration",
        "图片下载数量超过上限",
      );
    }
    const bySourceRef = new Map<string, FigmaRemoteImage>();
    for (const request of requests) {
      if (
        request.sourceRef.length < 1 ||
        request.sourceRef.length > 512
      ) {
        throw new FigmaAssetError(
          "invalid_source_ref",
          "图片来源引用无效",
        );
      }
      parseFigmaImageUrl(request.url);
      const existing = bySourceRef.get(request.sourceRef);
      if (
        existing &&
        (existing.url !== request.url || existing.kind !== request.kind)
      ) {
        throw new FigmaAssetError(
          "invalid_source_ref",
          "同一图片来源引用指向冲突资源",
        );
      }
      bySourceRef.set(request.sourceRef, request);
    }

    const groups = new Map<
      string,
      { url: string; requests: FigmaRemoteImage[] }
    >();
    for (const request of bySourceRef.values()) {
      const current = groups.get(request.url) ?? {
        url: request.url,
        requests: [],
      };
      current.requests.push(request);
      groups.set(request.url, current);
    }

    const queue = [...groups.values()];
    const output = new Map<string, LocalImageRef>();
    const internalAbort = new AbortController();
    const combined = combineAbortSignals(
      externalSignal,
      internalAbort.signal,
    );
    let cursor = 0;
    let firstError: unknown;
    const worker = async () => {
      while (!firstError) {
        const index = cursor;
        cursor += 1;
        const group = queue[index];
        if (!group) {
          return;
        }
        try {
          const bytes = await this.downloadOne(
            group.url,
            combined.signal,
          );
          const refsByKind = new Map<
            "assets" | "screenshots",
            LocalImageRef
          >();
          for (const request of group.requests) {
            let localRef = refsByKind.get(request.kind);
            if (!localRef) {
              localRef = await this.projectStore.saveLocalImage({
                projectId,
                kind: request.kind,
                bytes,
              });
              refsByKind.set(request.kind, localRef);
            }
            output.set(request.sourceRef, localRef);
          }
        } catch (error) {
          firstError ??= error;
          internalAbort.abort();
        }
      }
    };

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(this.maxConcurrency, queue.length) },
          () => worker(),
        ),
      );
    } finally {
      combined.cleanup();
    }
    if (firstError) {
      throw firstError;
    }
    return output;
  }

  private async downloadOne(
    urlInput: string,
    externalSignal: AbortSignal,
  ): Promise<Uint8Array> {
    const url = parseFigmaImageUrl(urlInput);
    const downloadSignal = createDownloadSignal(
      externalSignal,
      this.timeoutMs,
    );
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { Accept: "image/png,image/jpeg,image/webp" },
          redirect: "manual",
          signal: downloadSignal.signal,
        });
      } catch {
        if (externalSignal.aborted) {
          throw new FigmaAssetError(
            "aborted",
            "Figma 图片下载已取消",
          );
        }
        if (downloadSignal.didTimeout()) {
          throw new FigmaAssetError(
            "timeout",
            "Figma 图片下载超时",
          );
        }
        throw new FigmaAssetError(
          "network_error",
          "Figma 图片网络请求失败",
        );
      }
      if (response.status >= 300 && response.status <= 399) {
        await response.body?.cancel();
        throw new FigmaAssetError(
          "redirect_forbidden",
          "Figma 图片下载拒绝重定向",
          response.status,
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new FigmaAssetError(
          "http_error",
          `Figma 图片下载返回 HTTP ${response.status}`,
          response.status,
        );
      }
      const contentType = normalizedContentType(response);
      if (!contentType) {
        await response.body?.cancel();
        throw new FigmaAssetError(
          "invalid_content_type",
          "Figma 图片响应 MIME 不受支持",
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedImage(response, this.maxImageBytes);
      } catch (error) {
        if (error instanceof FigmaAssetError) {
          throw error;
        }
        if (externalSignal.aborted) {
          throw new FigmaAssetError(
            "aborted",
            "Figma 图片响应读取已取消",
          );
        }
        if (downloadSignal.didTimeout()) {
          throw new FigmaAssetError(
            "timeout",
            "Figma 图片响应读取超时",
          );
        }
        throw new FigmaAssetError(
          "network_error",
          "Figma 图片响应读取失败",
        );
      }
      let inspected;
      try {
        inspected = inspectImageBytes(bytes);
      } catch (error) {
        if (error instanceof ImageFormatError) {
          throw new FigmaAssetError(
            "invalid_image",
            "Figma 图片魔数或尺寸无效",
          );
        }
        throw error;
      }
      if (inspected.mimeType !== contentType) {
        throw new FigmaAssetError(
          "format_mismatch",
          "Figma 图片 MIME 与魔数不一致",
        );
      }
      return bytes;
    } finally {
      downloadSignal.cleanup();
    }
  }
}
