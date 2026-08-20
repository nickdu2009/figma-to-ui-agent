/**
 * DesignAsset HTTP 路由（设计 §5.4 L431，计划 S7）：
 * - 版本化 GET/HEAD 读取面（generation/draft/published），响应统一
 *   private,no-store + nosniff + 精确 MIME + 内容哈希 ETag；不支持 Range；
 * - 上传/列表面（所有者/编辑者）：multipart 或二进制体 → service 编排；
 * - 所有错误映射为受控 404/403/413（不泄露资产存在性差异）；
 * - 原始字节/哈希/路径不进入日志。
 */
import { Hono, type Context } from "hono";

import { createSessionMiddleware, requireSession } from "../middleware/session.ts";
import { requireRole } from "../middleware/app-guard.ts";
import { badRequest, notFound } from "../middleware/errors.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { AuthService } from "../auth/service.ts";
import type {
  DesignAssetErrorCode,
} from "../design-assets/contracts.ts";
import type { DesignAssetService } from "../design-assets/service.ts";
import type {
  DesignAssetReadResolver,
  ResolvedAssetContent,
} from "../design-assets/read-resolver.ts";

function mapAssetError(code: DesignAssetErrorCode): never {
  switch (code) {
    case "asset_forbidden":
      throw notFound(); // 与缺失不可区分（存在性保护）
    case "asset_limit_exceeded":
      throw badRequest("asset_limit_exceeded", "设计资源配额已满");
    case "asset_store_unavailable":
      throw badRequest("asset_store_unavailable", "资源存储不可用");
    case "asset_mime_forbidden":
    case "asset_magic_mismatch":
      throw badRequest("asset_invalid", "资源类型不受支持");
    case "asset_hash_mismatch":
    case "asset_byte_length_mismatch":
      throw badRequest("asset_invalid", "资源校验失败");
    default:
      throw notFound();
  }
}

function contentHeaders(
  resolved: ResolvedAssetContent,
): Record<string, string> {
  return {
    "Content-Type": resolved.mimeType,
    "Content-Length": String(resolved.byteLength),
    ETag: `"${resolved.etag}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

/** Hono 响应体要求 Uint8Array<ArrayBuffer>：显式拷贝到新缓冲。 */
function toResponseBody(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

const PURPOSES = new Set([
  "brand_guide_pdf",
  "reference_screenshot",
  "publishable_source",
]);

export function createDesignAssetRoutes(deps: {
  authService: AuthService;
  appRepository: AppRepository;
  service: DesignAssetService;
  readResolver: DesignAssetReadResolver;
}): Hono {
  const routes = new Hono();
  routes.use("*", createSessionMiddleware(deps.authService));

  /** 上传并排队提取（编辑者及以上）。 */
  routes.post(
    "/apps/:appId/design-assets/sources",
    async (c) => {
      const { user } = requireSession(c);
      const appId = c.req.param("appId");
      const membership = await requireRole(deps.appRepository, appId, user.id, "editor", {
        conceal: true,
      });
      const purpose = c.req.query("purpose") ?? "";
      const displayName = c.req.query("displayName") ?? "design-source";
      if (!PURPOSES.has(purpose)) {
        throw badRequest("asset_invalid", "purpose 不合法");
      }
      const declared = c.req.header("content-type") ?? "application/octet-stream";
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw badRequest("asset_invalid", "空资源");
      }
      const result = await deps.service
        .uploadSource({
          appId,
          createdByMembershipId: membership.id,
          purpose: purpose as
            | "brand_guide_pdf"
            | "reference_screenshot"
            | "publishable_source",
          displayName,
          bytes,
          declaredMimeType: declared,
        })
        .catch((error: { code?: string }) => {
          if (error?.code) mapAssetError(error.code as DesignAssetErrorCode);
          throw error;
        });
      return c.json(
        {
          sourceId: result.source.id,
          status: result.source.status,
          blobContentHash: result.blobContentHash,
          jobId: result.jobId,
        },
        201,
      );
    },
  );

  /** 列出 app 的 source（编辑者及以上；无字节/路径）。 */
  routes.get("/apps/:appId/design-assets/sources", async (c) => {
    const { user } = requireSession(c);
    const appId = c.req.param("appId");
    await requireRole(deps.appRepository, appId, user.id, "editor", {
      conceal: true,
    });
    const sources = await deps.service.listSourcesForApp({ appId });
    return c.json({
      sources: sources.map((source) => ({
        sourceId: source.id,
        purpose: source.purpose,
        displayName: source.displayName,
        status: source.status,
        blobContentHash: source.blobContentHash,
        readyExtractionId: source.readyExtractionId,
        createdAt: source.createdAt,
      })),
    });
  });

  /** generation 读取面（candidateDigest 必须精确匹配）。 */
  const generationFace = async (c: Context, isHead: boolean) => {
    const { user } = requireSession(c);
    const resolved = await deps.readResolver
      .resolveGenerationAsset({
        appId: c.req.param("appId") ?? "",
        generationId: c.req.param("generationId") ?? "",
        candidateDigest: c.req.query("candidateDigest") ?? "",
        assetId: c.req.param("assetId") ?? "",
        userId: user.id,
        minRoleForDraftAccess: "editor",
      })
      .catch((error: { code?: string }) => {
        if (error?.code) mapAssetError(error.code as DesignAssetErrorCode);
        throw error;
      });
    const headers = contentHeaders(resolved);
    return isHead
      ? c.newResponse(null, 200, headers)
      : c.newResponse(toResponseBody(resolved.bytes), 200, headers);
  };
  const generationPath =
    "/apps/:appId/generations/:generationId/design-assets/:assetId/content";
  routes.get(generationPath, (c) => generationFace(c, false));
  routes.on("HEAD", generationPath, (c) => generationFace(c, true));

  /** draft 读取面。 */
  const draftFace = async (c: Context, isHead: boolean) => {
    const { user } = requireSession(c);
    const resolved = await deps.readResolver
      .resolveDraftAsset({
        appId: c.req.param("appId") ?? "",
        draftId: c.req.param("draftId") ?? "",
        assetId: c.req.param("assetId") ?? "",
        userId: user.id,
      })
      .catch((error: { code?: string }) => {
        if (error?.code) mapAssetError(error.code as DesignAssetErrorCode);
        throw error;
      });
    const headers = contentHeaders(resolved);
    return isHead
      ? c.newResponse(null, 200, headers)
      : c.newResponse(toResponseBody(resolved.bytes), 200, headers);
  };
  const draftPath = "/apps/:appId/drafts/:draftId/design-assets/:assetId/content";
  routes.get(draftPath, (c) => draftFace(c, false));
  routes.on("HEAD", draftPath, (c) => draftFace(c, true));

  /** published 读取面。 */
  const publishedFace = async (c: Context, isHead: boolean) => {
    const { user } = requireSession(c);
    const resolved = await deps.readResolver
      .resolvePublishedAsset({
        appId: c.req.param("appId") ?? "",
        publishedVersionId: c.req.param("publishedVersionId") ?? "",
        assetId: c.req.param("assetId") ?? "",
        userId: user.id,
      })
      .catch((error: { code?: string }) => {
        if (error?.code) mapAssetError(error.code as DesignAssetErrorCode);
        throw error;
      });
    const headers = contentHeaders(resolved);
    return isHead
      ? c.newResponse(null, 200, headers)
      : c.newResponse(toResponseBody(resolved.bytes), 200, headers);
  };
  const publishedPath =
    "/apps/:appId/published-versions/:publishedVersionId/design-assets/:assetId/content";
  routes.get(publishedPath, (c) => publishedFace(c, false));
  routes.on("HEAD", publishedPath, (c) => publishedFace(c, true));

  return routes;
}
