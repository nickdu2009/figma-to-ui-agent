/**
 * AssetUrlResolver 与 ResolvedAssetHandle（设计 §5.1/§11.3，计划 S6）：
 * - Controller-private：handle 只存在 Controller 内存（不写 state/Bundle/log）；
 * - `url(asset:<assetId>)` 与组件资源 props 经 resolver 解析：受控字节获取 →
 *   核对 Manifest contentHash/MIME/byteLength → 创建仅当前 Controller 生命周期
 *   有效的 blob: URL（图片 Image.decode；字体 FontFace.load + digest 命名空间）；
 * - 候选/active 两代集合：commit 原子替换、失败只撤销候选、旧代在切换后销毁；
 * - S6 使用 fixture 字节源（不接真实 BlobStore；S7 接管真实路由）。
 */

export type AssetResolveErrorCode =
  | "asset_manifest_missing"
  | "asset_hash_mismatch"
  | "asset_mime_mismatch"
  | "asset_byte_length_mismatch"
  | "asset_fetch_failed"
  | "asset_decode_failed"
  | "asset_kind_forbidden"
  | "asset_limit_exceeded";

/** 单 Bundle 资源引用上限（§11.3）。 */
export const ASSET_REF_LIMIT = 100;

export interface ResolvedAssetHandle {
  readonly assetId: string;
  readonly contentHash: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly objectUrl: string;
  readonly fontFace?: FontFace;
  dispose(): void;
}

/** Manifest 条目（与 src/catalog/app-ui-bundle.ts 的合同同形）。 */
export interface AssetManifestLikeEntry {
  assetId: string;
  kind: "image" | "svg" | "font";
  contentHash: string;
  mimeType: string;
  byteLength: number;
}

export interface AssetManifestLike {
  entries: readonly AssetManifestLikeEntry[];
}

/** 受控字节获取接口：S6 fixture 提供；S7 接真实 private,no-store 路由。 */
export type AssetByteSource = (assetId: string) => Promise<{
  bytes: ArrayBuffer;
  mimeType: string;
}>;

/**
 * 版本化读取绑定（设计 §5.4 L431）：AssetUrlResolver 的受权网络请求
 * 绑定 generationId/candidateDigest、draftId 或 publishedVersionId。
 */
export type AssetReadBinding =
  | {
      kind: "generation";
      appId: string;
      generationId: string;
      candidateDigest: string;
    }
  | { kind: "draft"; appId: string; draftId: string }
  | { kind: "published"; appId: string; publishedVersionId: string };

/**
 * 由执行绑定构造受权字节源（S7）：每次 GET 重新授权（private,no-store），
 * 不复用任何缓存响应；失败抛 asset_fetch_failed（Resolver fail closed）。
 */
export function createRouteAssetByteSource(
  binding: AssetReadBinding,
): AssetByteSource {
  return async (assetId: string) => {
    const encodedAssetId = encodeURIComponent(assetId);
    let path: string;
    if (binding.kind === "generation") {
      path = `/api/apps/${binding.appId}/generations/${encodeURIComponent(
        binding.generationId,
      )}/design-assets/${encodedAssetId}/content?candidateDigest=${encodeURIComponent(
        binding.candidateDigest,
      )}`;
    } else if (binding.kind === "draft") {
      path = `/api/apps/${binding.appId}/drafts/${encodeURIComponent(
        binding.draftId,
      )}/design-assets/${encodedAssetId}/content`;
    } else {
      path = `/api/apps/${binding.appId}/published-versions/${encodeURIComponent(
        binding.publishedVersionId,
      )}/design-assets/${encodedAssetId}/content`;
    }
    let response: Response;
    try {
      response = await fetch(path, {
        method: "GET",
        credentials: "include",
      });
    } catch {
      throw new Error(`asset_fetch_failed:${assetId}`);
    }
    if (!response.ok) {
      throw new Error(`asset_fetch_failed:${assetId}`);
    }
    const mimeType =
      response.headers.get("content-type") ?? "application/octet-stream";
    const bytes = await response.arrayBuffer();
    return { bytes, mimeType };
  };
}

export interface AssetUrlResolverOptions {
  manifest: AssetManifestLike;
  fetchBytes: AssetByteSource;
  /** candidateDigest 短前缀（字体 family 命名空间）。 */
  digestPrefix: string;
  /** S6 Node 测试环境无 Image/FontFace 时禁用 decode（仍核对字节）。 */
  skipDecode?: boolean;
}

interface Generation {
  handles: Map<string, ResolvedAssetHandle>;
}

export class AssetUrlResolver {
  private readonly manifestById = new Map<string, AssetManifestLikeEntry>();
  private candidate: Generation | null = null;
  private active: Generation | null = null;
  private disposed = false;

  constructor(private readonly options: AssetUrlResolverOptions) {
    for (const entry of options.manifest.entries) {
      this.manifestById.set(entry.assetId, entry);
    }
  }

  /** 预暂存整套候选句柄（commit 前调用；失败不触碰 active）。 */
  async stageCandidate(assetIds: readonly string[]): Promise<void> {
    this.assertAlive();
    if (new Set(assetIds).size > ASSET_REF_LIMIT) {
      throw new Error("asset_limit_exceeded");
    }
    const generation: Generation = { handles: new Map() };
    for (const assetId of assetIds) {
      generation.handles.set(assetId, await this.resolveOne(assetId));
    }
    // 失败路径：撤销本代已建句柄，保持 active 完整。
    this.candidate = generation;
  }

  /** 原子提交：候选成为 active；旧代（若存在）在调用方确认切换后销毁。 */
  commitCandidate(): void {
    this.assertAlive();
    if (this.candidate === null) {
      throw new Error("asset_manifest_missing: no candidate to commit");
    }
    const previous = this.active;
    this.active = this.candidate;
    this.candidate = null;
    // 旧代延迟销毁交由调用方（Controller 在旧 Runtime dispose 后调 retire）。
    if (previous) {
      this.retired.push(previous);
    }
  }

  private retired: Generation[] = [];

  /** 撤销候选（保留 active 完整）。 */
  discardCandidate(): void {
    if (this.candidate === null) return;
    for (const handle of this.candidate.handles.values()) handle.dispose();
    this.candidate = null;
  }

  /** 销毁全部退役代（旧 Runtime dispose 后调用）。 */
  disposeRetired(): void {
    for (const generation of this.retired) {
      for (const handle of generation.handles.values()) handle.dispose();
    }
    this.retired = [];
  }

  /** 当前 active 代句柄（编译后 CSS/props 替换用）。 */
  getActiveHandle(assetId: string): ResolvedAssetHandle | null {
    return this.active?.handles.get(assetId) ?? null;
  }

  /** 候选代句柄（候选渲染树替换用）。 */
  getCandidateHandle(assetId: string): ResolvedAssetHandle | null {
    return this.candidate?.handles.get(assetId) ?? null;
  }

  get activeCount(): number {
    return this.active?.handles.size ?? 0;
  }

  get candidateCount(): number {
    return this.candidate?.handles.size ?? 0;
  }

  dispose(): void {
    this.disposed = true;
    this.discardCandidate();
    if (this.active) {
      for (const handle of this.active.handles.values()) handle.dispose();
      this.active = null;
    }
    this.disposeRetired();
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error("asset_fetch_failed: resolver disposed");
    }
  }

  private async resolveOne(assetId: string): Promise<ResolvedAssetHandle> {
    const entry = this.manifestById.get(assetId);
    if (!entry) {
      throw new Error(`asset_manifest_missing:${assetId}`);
    }
    let fetched: Awaited<ReturnType<AssetByteSource>>;
    try {
      fetched = await this.options.fetchBytes(assetId);
    } catch {
      throw new Error(`asset_fetch_failed:${assetId}`);
    }
    if (fetched.mimeType !== entry.mimeType) {
      throw new Error(`asset_mime_mismatch:${assetId}`);
    }
    if (fetched.bytes.byteLength !== entry.byteLength) {
      throw new Error(`asset_byte_length_mismatch:${assetId}`);
    }
    const hash = await sha256Hex(fetched.bytes);
    if (`sha256:${hash}` !== entry.contentHash) {
      throw new Error(`asset_hash_mismatch:${assetId}`);
    }

    const blob = new Blob([fetched.bytes], { type: entry.mimeType });
    const objectUrl = URL.createObjectURL(blob);
    let fontFace: FontFace | undefined;

    if (entry.kind === "font") {
      if (this.options.skipDecode !== true && typeof FontFace !== "undefined") {
        const family = `vmaf-${this.options.digestPrefix}-${entry.assetId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
        fontFace = new FontFace(family, fetched.bytes);
        try {
          await fontFace.load();
          if (typeof document !== "undefined") {
            (document as unknown as { fonts: FontFaceSet }).fonts.add(fontFace);
          }
        } catch {
          URL.revokeObjectURL(objectUrl);
          throw new Error(`asset_decode_failed:${assetId}`);
        }
      }
    } else if (entry.kind === "image" && this.options.skipDecode !== true && typeof Image !== "undefined") {
      try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
      } catch {
        URL.revokeObjectURL(objectUrl);
        throw new Error(`asset_decode_failed:${assetId}`);
      }
    }

    let disposedFlag = false;
    return {
      assetId: entry.assetId,
      contentHash: entry.contentHash,
      mimeType: entry.mimeType,
      byteLength: entry.byteLength,
      objectUrl,
      ...(fontFace ? { fontFace } : {}),
      dispose() {
        if (disposedFlag) return;
        disposedFlag = true;
        URL.revokeObjectURL(objectUrl);
        if (fontFace && typeof document !== "undefined") {
          (document as unknown as { fonts: FontFaceSet }).fonts.delete(fontFace);
        }
      },
    };
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }
  // Node 环境（测试）回退。
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  hash.update(new Uint8Array(bytes));
  return hash.digest("hex");
}
