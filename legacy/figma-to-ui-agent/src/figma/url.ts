import { z } from "zod";

const FIGMA_DESIGN_HOSTS = new Set(["figma.com", "www.figma.com"]);
const FIGMA_FILE_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const FIGMA_NODE_ID_PATTERN =
  /^(?:I)?\d+(?::|-)\d+(?:;(?:I)?\d+(?::|-)\d+)*$/;

export type FigmaInputErrorCode =
  | "invalid_url"
  | "invalid_protocol"
  | "invalid_host"
  | "credentials_forbidden"
  | "invalid_design_path"
  | "invalid_file_key"
  | "invalid_node_id"
  | "conflicting_node_id";

export class FigmaInputError extends Error {
  readonly code: FigmaInputErrorCode;

  constructor(
    code: FigmaInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FigmaInputError";
    this.code = code;
  }
}

export interface ParsedFigmaDesignUrl {
  fileKey: string;
  nodeId?: string;
}

export function assertFigmaFileKey(value: string): string {
  if (!FIGMA_FILE_KEY_PATTERN.test(value)) {
    throw new FigmaInputError(
      "invalid_file_key",
      "Figma 文件键无效",
    );
  }
  return value;
}

export function normalizeFigmaNodeId(value: string): string {
  if (
    value.length > 512 ||
    value.trim() !== value ||
    !FIGMA_NODE_ID_PATTERN.test(value)
  ) {
    throw new FigmaInputError("invalid_node_id", "Figma 节点 ID 无效");
  }
  return value.replaceAll("-", ":");
}

export function parseFigmaDesignUrl(
  value: string,
): ParsedFigmaDesignUrl {
  if (value.length < 1 || value.length > 2_048) {
    throw new FigmaInputError("invalid_url", "Figma URL 长度无效");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FigmaInputError("invalid_url", "Figma URL 无效");
  }

  if (url.protocol !== "https:") {
    throw new FigmaInputError(
      "invalid_protocol",
      "Figma URL 必须使用 HTTPS",
    );
  }
  if (!FIGMA_DESIGN_HOSTS.has(url.hostname)) {
    throw new FigmaInputError(
      "invalid_host",
      "Figma URL 主机不在允许列表",
    );
  }
  if (url.username || url.password) {
    throw new FigmaInputError(
      "credentials_forbidden",
      "Figma URL 不能包含用户信息",
    );
  }
  if (url.port && url.port !== "443") {
    throw new FigmaInputError(
      "invalid_host",
      "Figma URL 不能使用非标准端口",
    );
  }
  if (url.hash) {
    throw new FigmaInputError(
      "invalid_url",
      "Figma URL 不能包含片段",
    );
  }

  const pathSegments = url.pathname.split("/");
  if (pathSegments.at(-1) === "") {
    pathSegments.pop();
  }
  if (
    pathSegments.length !== 4 ||
    pathSegments[0] !== "" ||
    pathSegments[1] !== "design" ||
    pathSegments[3] === ""
  ) {
    throw new FigmaInputError(
      "invalid_design_path",
      "Figma URL 必须是 /design/<fileKey>/<name> 形式",
    );
  }

  let fileKey: string;
  try {
    fileKey = decodeURIComponent(pathSegments[2]!);
    decodeURIComponent(pathSegments[3]!);
  } catch {
    throw new FigmaInputError(
      "invalid_design_path",
      "Figma URL 路径编码无效",
    );
  }
  assertFigmaFileKey(fileKey);

  const rawNodeIds = url.searchParams.getAll("node-id");
  const normalizedNodeIds = rawNodeIds.map(normalizeFigmaNodeId);
  if (new Set(normalizedNodeIds).size > 1) {
    throw new FigmaInputError(
      "conflicting_node_id",
      "Figma URL 包含冲突的 node-id",
    );
  }

  return {
    fileKey,
    nodeId: normalizedNodeIds[0],
  };
}

export function resolveFigmaTargetNodes(
  parsedUrl: ParsedFigmaDesignUrl,
  targetNodes: readonly string[] | undefined,
): string[] {
  const normalizedTargets = (targetNodes ?? []).map(
    normalizeFigmaNodeId,
  );
  const uniqueTargets = [...new Set(normalizedTargets)];
  if (
    parsedUrl.nodeId &&
    uniqueTargets.length > 0 &&
    !uniqueTargets.includes(parsedUrl.nodeId)
  ) {
    throw new FigmaInputError(
      "conflicting_node_id",
      "URL node-id 与 targetNodes 冲突",
    );
  }
  if (parsedUrl.nodeId && uniqueTargets.length === 0) {
    return [parsedUrl.nodeId];
  }
  return uniqueTargets;
}

export const figmaDesignUrlSchema = z
  .string()
  .min(1)
  .max(2_048)
  .superRefine((value, ctx) => {
    try {
      parseFigmaDesignUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof FigmaInputError
            ? error.message
            : "Figma URL 无效",
      });
    }
  });

export const figmaNodeIdSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((value, ctx) => {
    try {
      normalizeFigmaNodeId(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof FigmaInputError
            ? error.message
            : "Figma 节点 ID 无效",
      });
    }
  });
