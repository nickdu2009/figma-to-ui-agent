/**
 * DesignAsset 服务层（设计 §5.4/§9 设计资源边界，计划 S7 动作 4/5）：
 * - 上传：BlobStore 原子写入 → per-app 限额 Gate（≤20 source / 引用去重
 *   Blob 合计 ≤100 MiB）→ ensureBlob → createSource → enqueue job；
 * - 生成输入重验（GenerationRun 创建事务内调用）：app/Membership/source/
 *   hash/extraction 全量重验后返回不可变 brandSourceSnapshot 条目
 *   （{sourceId,sourceContentHash,extractionId,extractionDigest,
 *   extractorProfileVersion}），不返回任何正文；
 * - 单次生成 ≤8 个 ready source、单份摘要 ≤64 KiB、合计 ≤256 KiB。
 */
import { createHash } from "node:crypto";

import {
  BLOB_MAX_BYTES,
  EXTRACTOR_PROFILE_VERSION,
  GENERATION_SUMMARIES_MAX_BYTES,
  PER_APP_SOURCE_LIMIT,
  PER_APP_TOTAL_BLOB_BYTES,
  PER_GENERATION_SOURCE_REFS,
  SUMMARY_MAX_BYTES,
  designAssetError,
} from "./contracts.ts";
import type { BlobStore } from "./blob-store.ts";
import type { DesignAssetRepository } from "../repositories/design-asset-repository.ts";
import type { DesignAssetSourcePurpose } from "../repositories/design-asset-repository.ts";
import type { DesignAssetSourceRow } from "../db/schema.ts";

export interface BrandSourceSnapshotEntry {
  sourceId: string;
  sourceContentHash: string;
  extractionId: string;
  extractionDigest: string;
  extractorProfileVersion: string;
}

export interface DesignAssetService {
  /**
   * 上传并排队提取（原始字节只在本调用与 BlobStore 内存在；
   * 返回 source 行与派生信息，不含任何路径）。
   */
  uploadSource(input: {
    appId: string;
    createdByMembershipId: string;
    purpose: DesignAssetSourcePurpose;
    displayName: string;
    bytes: Uint8Array;
    declaredMimeType: string;
  }): Promise<{
    source: DesignAssetSourceRow;
    blobContentHash: string;
    jobId: string;
  }>;

  listSourcesForApp(input: {
    appId: string;
  }): Promise<DesignAssetSourceRow[]>;

  /**
   * 生成输入重验（§9 L956）：只接受 ready source；重验 app 归属、
   * readyExtractionId、Extraction status/sourceContentHash/summaryDigest/
   * byteLength；固定不可变快照条目。摘要合计超 256 KiB 拒绝。
   */
  buildBrandSourceSnapshot(input: {
    appId: string;
    sourceIds: readonly string[];
    expectedContentHashes: Readonly<Record<string, string>>;
  }): Promise<BrandSourceSnapshotEntry[]>;
}

export class DefaultDesignAssetService implements DesignAssetService {
  private readonly repository: DesignAssetRepository;
  private readonly blobStore: BlobStore;

  constructor(
    repository: DesignAssetRepository,
    blobStore: BlobStore,
  ) {
    this.repository = repository;
    this.blobStore = blobStore;
  }

  async uploadSource(input: {
    appId: string;
    createdByMembershipId: string;
    purpose: DesignAssetSourcePurpose;
    displayName: string;
    bytes: Uint8Array;
    declaredMimeType: string;
  }): Promise<{
    source: DesignAssetSourceRow;
    blobContentHash: string;
    jobId: string;
  }> {
    if (input.bytes.byteLength > BLOB_MAX_BYTES) {
      throw designAssetError("asset_limit_exceeded");
    }
    const usage = await this.repository.getAppSourceUsage(input.appId);
    if (usage.sourceCount >= PER_APP_SOURCE_LIMIT) {
      throw designAssetError("asset_limit_exceeded");
    }
    // 新 Blob 去重后再核合计（已引用的同哈希 Blob 不重复计入）。
    const candidateHash = `sha256:${createHash("sha256").update(input.bytes).digest("hex")}`;
    const existingBlob = await this.repository.findBlob(candidateHash);
    const projectedBytes =
      usage.totalBlobBytes + (existingBlob ? 0 : input.bytes.byteLength);
    if (projectedBytes > PER_APP_TOTAL_BLOB_BYTES) {
      throw designAssetError("asset_limit_exceeded");
    }

    const verified = await this.blobStore.write({
      bytes: input.bytes,
      declaredMimeType: input.declaredMimeType,
    });
    if (verified.contentHash !== candidateHash) {
      // 理论不可达（同一次哈希）；fail closed 保守处理。
      throw designAssetError("asset_hash_mismatch");
    }
    const blob = await this.repository.ensureBlob({
      contentHash: verified.contentHash,
      mimeType: verified.mimeType,
      byteLength: verified.byteLength,
      kind: verified.kind,
    });
    const source = await this.repository.createSource({
      appId: input.appId,
      createdByMembershipId: input.createdByMembershipId,
      blobContentHash: blob.contentHash,
      purpose: input.purpose,
      displayName: input.displayName.slice(0, 255),
    });
    const job = await this.repository.enqueueJob({
      appId: input.appId,
      sourceId: source.id,
      sourceContentHash: blob.contentHash,
      extractorProfileVersion: EXTRACTOR_PROFILE_VERSION,
    });
    return { source, blobContentHash: blob.contentHash, jobId: job.id };
  }

  async listSourcesForApp(input: {
    appId: string;
  }): Promise<DesignAssetSourceRow[]> {
    return this.repository.listSources(input.appId);
  }

  async buildBrandSourceSnapshot(input: {
    appId: string;
    sourceIds: readonly string[];
    expectedContentHashes: Readonly<Record<string, string>>;
  }): Promise<BrandSourceSnapshotEntry[]> {
    if (new Set(input.sourceIds).size > PER_GENERATION_SOURCE_REFS) {
      throw designAssetError("asset_limit_exceeded");
    }
    const entries: BrandSourceSnapshotEntry[] = [];
    let totalSummaryBytes = 0;
    for (const sourceId of input.sourceIds) {
      const source = await this.repository.findSourceById(sourceId);
      // 归属/status/哈希任一不符 → 统一 asset_not_found（不泄露存在性差异）。
      if (
        !source ||
        source.appId !== input.appId ||
        source.status !== "ready" ||
        source.readyExtractionId === null ||
        source.blobContentHash !== (input.expectedContentHashes[sourceId] ?? "")
      ) {
        throw designAssetError("asset_not_found");
      }
      const extraction = await this.repository.findExtractionById(
        source.readyExtractionId,
      );
      if (
        !extraction ||
        extraction.sourceId !== source.id ||
        extraction.sourceContentHash !== source.blobContentHash ||
        extraction.status !== "ready" ||
        extraction.extractorProfileVersion !== EXTRACTOR_PROFILE_VERSION
      ) {
        throw designAssetError("asset_not_found");
      }
      if (extraction.byteLength > SUMMARY_MAX_BYTES) {
        throw designAssetError("asset_limit_exceeded");
      }
      totalSummaryBytes += extraction.byteLength;
      if (totalSummaryBytes > GENERATION_SUMMARIES_MAX_BYTES) {
        throw designAssetError("asset_limit_exceeded");
      }
      entries.push({
        sourceId: source.id,
        sourceContentHash: source.blobContentHash,
        extractionId: extraction.id,
        extractionDigest: extraction.summaryDigest,
        extractorProfileVersion: extraction.extractorProfileVersion,
      });
    }
    return entries;
  }
}
