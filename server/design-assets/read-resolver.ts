/**
 * DesignAsset Read Resolver（设计 §5.4 L431-442，计划 S7 动作 6）：
 * - 三类版本化读取面（generation/draft/published）GET/HEAD；
 * - 全量重授权：Session/Membership、path appId 归属、版本/run 归属、
 *   generation 面的 candidateDigest 精确匹配、AssetManifest assetId 与
 *   contentHash 匹配、ready 元数据、Blob 实际 hash 逐项核对；
 * - 查看者只能读取 ReleasePointer 指向的 PublishedVersion；所有者/编辑者
 *   可读取仍保留的 Draft/Published 与保留期内 digest 精确匹配的
 *   staging/unsaved 候选；
 * - 任何缺失/不匹配 fail closed 为同一受控错误（不泄露存在性差异）；
 * - 返回精确 MIME（魔数确认）、字节与 ETag（内容哈希）；
 *   Cache-Control 由路由层统一 private,no-store；
 * - 不开放公开 hash/path 静态路由，不暴露 VMA_ASSET_ROOT。
 */
import { createHash } from "node:crypto";

import { designAssetError } from "./contracts.ts";
import { sniffMagic } from "./blob-store.ts";
import type { BlobStore } from "./blob-store.ts";
import type { DesignAssetRepository } from "../repositories/design-asset-repository.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { ReleaseRepository } from "../repositories/release-repository.ts";
import type { AppRole } from "../middleware/app-guard.ts";

/** 终态 run 的候选保留窗口（7 天，设计 L428）。 */
export const TERMINAL_RUN_CANDIDATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResolvedAssetContent {
  bytes: Uint8Array;
  mimeType: string; // 魔数确认后的精确 MIME
  byteLength: number;
  etag: string; // 内容哈希（W/ 无关，裸 sha256:<hex>）
}

interface ManifestEntry {
  assetId: string;
  contentHash: string;
}

function manifestEntries(bundleJson: unknown): ManifestEntry[] {
  if (
    bundleJson === null ||
    typeof bundleJson !== "object" ||
    !("assets" in bundleJson)
  ) {
    return [];
  }
  const entries = (bundleJson as { assets?: { entries?: unknown } }).assets
    ?.entries;
  if (!Array.isArray(entries)) return [];
  const result: ManifestEntry[] = [];
  for (const entry of entries) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "assetId" in entry &&
      "contentHash" in entry
    ) {
      const candidate = entry as { assetId: unknown; contentHash: unknown };
      if (
        typeof candidate.assetId === "string" &&
        typeof candidate.contentHash === "string"
      ) {
        result.push({
          assetId: candidate.assetId,
          contentHash: candidate.contentHash,
        });
      }
    }
  }
  return result;
}

/** manifest→blob→磁盘→魔数→哈希 全链路核对（任一失败即 asset_not_found）。 */
async function loadVerifiedAsset(input: {
  blobStore: BlobStore;
  repository: DesignAssetRepository;
  manifestEntry: ManifestEntry;
}): Promise<ResolvedAssetContent> {
  const blob = await input.repository.findBlob(input.manifestEntry.contentHash);
  if (!blob || blob.status !== "ready") {
    throw designAssetError("asset_not_found");
  }
  const hashHex = blob.contentHash.replace(/^sha256:/, "");
  const relativePath = `sha256/${hashHex.slice(0, 2)}/${hashHex}`;
  let bytes: Uint8Array;
  try {
    bytes = await input.blobStore.read(relativePath);
  } catch {
    throw designAssetError("asset_not_found"); // 缺失 Blob fail closed
  }
  if (bytes.byteLength !== blob.byteLength) {
    throw designAssetError("asset_not_found");
  }
  const sniffed = sniffMagic(bytes.subarray(0, 64));
  if (!sniffed || sniffed.mime !== blob.mimeType) {
    throw designAssetError("asset_not_found");
  }
  const actualHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actualHash !== blob.contentHash) {
    throw designAssetError("asset_not_found");
  }
  return {
    bytes,
    mimeType: sniffed.mime,
    byteLength: bytes.byteLength,
    etag: blob.contentHash,
  };
}

const NON_TERMINAL_RUN_STATUSES = new Set([
  "running",
  "awaiting_recovery",
  "recovery_pending",
  "recovering",
  "validation_running",
]);

export interface DesignAssetReadResolver {
  /** generation 面：candidateDigest 必须与 run 精确匹配。 */
  resolveGenerationAsset(input: {
    appId: string;
    generationId: string;
    candidateDigest: string;
    assetId: string;
    userId: string;
    minRoleForDraftAccess: AppRole;
  }): Promise<ResolvedAssetContent>;

  /** draft 面：所有者/编辑者。 */
  resolveDraftAsset(input: {
    appId: string;
    draftId: string;
    assetId: string;
    userId: string;
  }): Promise<ResolvedAssetContent>;

  /** published 面：查看者仅 ReleasePointer 指向版本；编辑者/所有者可读保留版本。 */
  resolvePublishedAsset(input: {
    appId: string;
    publishedVersionId: string;
    assetId: string;
    userId: string;
  }): Promise<ResolvedAssetContent>;
}

export class DefaultDesignAssetReadResolver implements DesignAssetReadResolver {
  private readonly appRepository: AppRepository;
  private readonly releaseRepository: ReleaseRepository;
  private readonly designAssetRepository: DesignAssetRepository;
  private readonly blobStore: BlobStore;

  constructor(
    appRepository: AppRepository,
    releaseRepository: ReleaseRepository,
    designAssetRepository: DesignAssetRepository,
    blobStore: BlobStore,
  ) {
    this.appRepository = appRepository;
    this.releaseRepository = releaseRepository;
    this.designAssetRepository = designAssetRepository;
    this.blobStore = blobStore;
  }

  private async requireAppMembership(input: {
    appId: string;
    userId: string;
  }): Promise<AppRole> {
    const app = await this.appRepository.findAppById(input.appId);
    if (!app || app.status === "deleted") {
      throw designAssetError("asset_not_found");
    }
    const membership = await this.appRepository.findActiveMembership(
      input.appId,
      input.userId,
    );
    if (!membership) throw designAssetError("asset_not_found");
    return membership.role as AppRole;
  }

  async resolveGenerationAsset(input: {
    appId: string;
    generationId: string;
    candidateDigest: string;
    assetId: string;
    userId: string;
    minRoleForDraftAccess: AppRole;
  }): Promise<ResolvedAssetContent> {
    const role = await this.requireAppMembership(input);
    if (role === "viewer") throw designAssetError("asset_forbidden");
    void input.minRoleForDraftAccess;

    const run =
      (await this.releaseRepository.findRunById(input.generationId)) ??
      (await this.releaseRepository.findRunByCorrelationRef(
        input.generationId,
      ));
    if (!run || run.appId !== input.appId) {
      throw designAssetError("asset_not_found");
    }
    // 候选仍在保留期：非终态不限；终态 7 天审计窗口内可读。
    const terminal = !NON_TERMINAL_RUN_STATUSES.has(run.status);
    if (
      terminal &&
      Date.now() - run.createdAt.getTime() > TERMINAL_RUN_CANDIDATE_RETENTION_MS
    ) {
      throw designAssetError("asset_not_found");
    }
    if (
      !run.candidateDigest ||
      run.candidateDigest !== input.candidateDigest ||
      !run.candidateBundle
    ) {
      throw designAssetError("asset_not_found");
    }
    const entry = manifestEntries(run.candidateBundle).find(
      (candidate) => candidate.assetId === input.assetId,
    );
    if (!entry) throw designAssetError("asset_not_found");
    return loadVerifiedAsset({
      blobStore: this.blobStore,
      repository: this.designAssetRepository,
      manifestEntry: entry,
    });
  }

  async resolveDraftAsset(input: {
    appId: string;
    draftId: string;
    assetId: string;
    userId: string;
  }): Promise<ResolvedAssetContent> {
    const role = await this.requireAppMembership(input);
    if (role === "viewer") throw designAssetError("asset_forbidden");
    const draft = await this.releaseRepository.findDraftById(input.draftId);
    if (!draft || draft.appId !== input.appId || !draft.bundle) {
      throw designAssetError("asset_not_found");
    }
    const entry = manifestEntries(draft.bundle).find(
      (candidate) => candidate.assetId === input.assetId,
    );
    if (!entry) throw designAssetError("asset_not_found");
    return loadVerifiedAsset({
      blobStore: this.blobStore,
      repository: this.designAssetRepository,
      manifestEntry: entry,
    });
  }

  async resolvePublishedAsset(input: {
    appId: string;
    publishedVersionId: string;
    assetId: string;
    userId: string;
  }): Promise<ResolvedAssetContent> {
    const role = await this.requireAppMembership(input);
    const version = await this.releaseRepository.findPublishedVersionById(
      input.publishedVersionId,
    );
    if (!version || version.appId !== input.appId || !version.bundle) {
      throw designAssetError("asset_not_found");
    }
    if (role === "viewer") {
      // 查看者只能读取 ReleasePointer 当前指向的 PublishedVersion。
      const pointer = await this.releaseRepository.getReleasePointer(
        input.appId,
      );
      if (!pointer || pointer.publishedVersionId !== input.publishedVersionId) {
        throw designAssetError("asset_forbidden");
      }
    }
    const entry = manifestEntries(version.bundle).find(
      (candidate) => candidate.assetId === input.assetId,
    );
    if (!entry) throw designAssetError("asset_not_found");
    return loadVerifiedAsset({
      blobStore: this.blobStore,
      repository: this.designAssetRepository,
      manifestEntry: entry,
    });
  }
}
