import type { Context } from "hono";
import { RepositoryError } from "../repositories/errors.ts";
import { redactForLog } from "../log-redact.ts";

/** 路由层统一错误：HTTP 状态 + 机器可读 code。 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function unauthorized(message = "未登录或会话已失效"): HttpError {
  return new HttpError(401, "unauthorized", message);
}

export function forbidden(code: string, message: string): HttpError {
  return new HttpError(403, code, message);
}

export function notFound(message = "资源不存在或不可见"): HttpError {
  return new HttpError(404, "not_found", message);
}

export function conflict(code: string, message: string): HttpError {
  return new HttpError(409, code, message);
}

export function badRequest(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): HttpError {
  return new HttpError(400, code, message, details);
}

/** 统一错误响应映射：{ error: { code, message, ...details } }。 */
export function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof HttpError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...error.details,
        },
      },
      error.status as 400,
    );
  }
  if (error instanceof RepositoryError) {
    const status = error.code === "not_found" ? 404 : 409;
    return c.json(
      { error: { code: error.code, message: error.message } },
      status,
    );
  }
  // 未知错误：不泄漏内部细节；日志统一脱敏截断（S7）
  console.error("[vite-multipage-agent] 未处理错误：", redactForLog(error));
  return c.json(
    { error: { code: "internal_error", message: "内部错误" } },
    500,
  );
}
