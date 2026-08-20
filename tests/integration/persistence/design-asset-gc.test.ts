/**
 * S7 集成测试 3：DesignAsset GC（计划 S7 验证，设计 §13.4 双快照可达性权威）。
 * 保护条款逐一验证：
 * - 有效 source / 恢复窗口（7 天）内 deleted source；
 * - 活动（queued/running）提取任务；
 * - 非终态或 7 天审计窗口内 run 的 brandSourceSnapshot 与 candidateBundle Manifest；
 * - Draft/Published（含回收站）Bundle Manifest；
 * - 终态且过审计窗的 run 不再经该条款保护；
 * - 完全不可达 Blob 从磁盘删除（remove 幂等，二次运行安全）；
 * - 元数据行保留（审计），文件读取 fail closed。
 * 每个用例使用唯一内容字节（IEND 后追加标记），避免内容寻址去重造成
 * 跨用例哈希干扰；uploadSource 留下的 queued job 会持续保护其哈希，
 * 需要回收的用例先显式终止该 job。MySQL 隔离 schema + 临时 VMA_ASSET_ROOT。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import { MysqlDesignAssetRepository } from "../../../server/repositories/design-asset-repository.ts";
import { LocalContentAddressedBlobStore } from "../../../server/design-assets/blob-store.ts";
import { DefaultDesignAssetService } from "../../../server/design-assets/service.ts";
import { DefaultDesignAssetGc } from "../../../server/design-assets/gc.ts";

const TINY_RED_PNG = await readFile("tests/fixtures/design-assets/tiny-red.png");
const GRADIENT_PNG = await readFile("tests/fixtures/design-assets/gradient.png");
const BRAND_PDF = await readFile("tests/fixtures/design-assets/brand-guide.pdf");

const DAY_MS = 24 * 60 * 60 * 1000;

/** 生成唯一内容（追加标记字节改变 sha256；魔数检测仍识别为原类型）。 */
function uniqueBytes(base: Buffer, tag: string): Buffer {
  return Buffer.concat([base, Buffer.from(`\n#${tag}`)]);
}

describe("S7 DesignAsset GC：双快照可达性", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let assetRoot: string;
  let store: LocalContentAddressedBlobStore;
  let repository: MysqlDesignAssetRepository;
  let service: DefaultDesignAssetService;
  let gc: DefaultDesignAssetGc;
  let appId: string;
  let membershipId: string;

  async function seedOrphanBlob(bytes: Buffer, mime: string) {
    const written = await store.write({ bytes, declaredMimeType: mime });
    await repository.ensureBlob({
      contentHash: written.contentHash,
      kind: written.kind,
      mimeType: written.mimeType,
      byteLength: written.byteLength,
    });
    return written;
  }

  async function uploadUnique(
    tag: string,
    base: Buffer = TINY_RED_PNG,
    mime = "image/png",
    purpose: "brand_guide_pdf" | "reference_screenshot" | "publishable_source" =
      "reference_screenshot",
  ) {
    return service.uploadSource({
      appId,
      createdByMembershipId: membershipId,
      purpose,
      displayName: `${tag}.${mime === "application/pdf" ? "pdf" : "png"}`,
      bytes: uniqueBytes(base, tag),
      declaredMimeType: mime,
    });
  }

  /** 终止某 source 的全部活动 job（测试内模拟 worker 完成/失败）。 */
  async function quiesceJobs(sourceId: string): Promise<void> {
    await pool.query(
      "UPDATE `design_asset_extraction_jobs` SET `status` = 'failed', `stable_error_code` = 'test_quiesced', `completed_at` = UTC_TIMESTAMP(3) WHERE `source_id` = ? AND `status` IN ('queued','running')",
      [sourceId],
    );
  }

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    assetRoot = await mkdtemp(path.join(tmpdir(), "vma-s7-gc-"));
    store = new LocalContentAddressedBlobStore(assetRoot, "test-server");
    repository = new MysqlDesignAssetRepository(handle.db);
    service = new DefaultDesignAssetService(repository, store);
    gc = new DefaultDesignAssetGc(handle.db, store, { maxBlobsPerRun: 100 });

    const userId = randomUUID();
    appId = randomUUID();
    membershipId = randomUUID();
    await pool.query(
      "INSERT INTO `users` (`id`, `email_normalized`, `email_display`, `created_at`, `updated_at`) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [userId, `u-${userId}@example.com`, `u-${userId}@example.com`],
    );
    await pool.query(
      "INSERT INTO `apps` (`id`, `name`, `created_by_user_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [appId, `app-${appId}`, userId],
    );
    await pool.query(
      "INSERT INTO `memberships` (`id`, `app_id`, `user_id`, `role`, `status`, `active_marker`, `created_at`) VALUES (?, ?, ?, 'owner', 'active', 'active', UTC_TIMESTAMP(3))",
      [membershipId, appId, userId],
    );
  }, 120000);

  afterAll(async () => {
    await dropTestDatabase(handle);
    await rm(assetRoot, { recursive: true, force: true });
  });

  it("完全不可达 Blob：候选→二次确认→删除（幂等；元数据保留）", async () => {
    const orphan = await seedOrphanBlob(uniqueBytes(TINY_RED_PNG, "orphan"), "image/png");
    const first = await gc.collect(new Date());
    expect(first.candidateBlobs).toBeGreaterThanOrEqual(1);
    expect(first.deletedBlobs).toBeGreaterThanOrEqual(1);
    await expect(store.read(orphan.relativePath)).rejects.toThrow();
    // 元数据行保留（审计面）。
    expect(await repository.findBlob(orphan.contentHash)).not.toBeNull();
    // 二次运行：文件已不存在，remove 幂等不抛错。
    await expect(gc.collect(new Date())).resolves.toBeTruthy();
  });

  it("有效 source 保护其 Blob", async () => {
    const upload = await uploadUnique("active-source");
    await gc.collect(new Date());
    const bytes = await store.read(
      `sha256/${upload.blobContentHash.replace(/^sha256:/, "").slice(0, 2)}/${upload.blobContentHash.replace(/^sha256:/, "")}`,
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("恢复窗口内 deleted source 仍保护；过窗后被回收", async () => {
    const upload = await uploadUnique(
      "deleted-source",
      BRAND_PDF,
      "application/pdf",
      "brand_guide_pdf",
    );
    const hex = upload.blobContentHash.replace(/^sha256:/, "");
    const pdfPath = `sha256/${hex.slice(0, 2)}/${hex}`;
    // uploadSource 留下的 queued job 会持续保护：先显式终止。
    await quiesceJobs(upload.source.id);
    await repository.markDeleted({ sourceId: upload.source.id });
    // 窗口内：保护。
    await gc.collect(new Date());
    await expect(store.read(pdfPath)).resolves.toBeTruthy();
    // 拨回 8 天前（仅测试 schema）→ 过窗回收。
    await pool.query(
      "UPDATE `design_asset_sources` SET `deleted_at` = ? WHERE `id` = ?",
      [new Date(Date.now() - 8 * DAY_MS), upload.source.id],
    );
    const report = await gc.collect(new Date());
    expect(report.deletedBlobs).toBeGreaterThanOrEqual(1);
    await expect(store.read(pdfPath)).rejects.toThrow();
  });

  it("活动提取任务（queued）保护其 sourceContentHash", async () => {
    const upload = await uploadUnique("job-protected", GRADIENT_PNG);
    const hex = upload.blobContentHash.replace(/^sha256:/, "");
    await gc.collect(new Date());
    await expect(store.read(`sha256/${hex.slice(0, 2)}/${hex}`)).resolves.toBeTruthy();
    // 清理：终止 job + 删除 source（不影响后续唯一内容用例）。
    await quiesceJobs(upload.source.id);
  });

  it("非终态 run 的 brandSourceSnapshot 与 candidateBundle Manifest 保护", async () => {
    const snapshotBlob = await seedOrphanBlob(uniqueBytes(TINY_RED_PNG, "snap"), "image/png");
    const manifestBlob = await seedOrphanBlob(uniqueBytes(GRADIENT_PNG, "manifest"), "image/png");
    const runId = randomUUID();
    await pool.query(
      "INSERT INTO `generation_runs` (`id`, `app_id`, `status`, `brand_source_snapshot`, `candidate_bundle`, `created_at`, `updated_at`) VALUES (?, ?, 'running', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [
        runId,
        appId,
        JSON.stringify([
          {
            sourceId: randomUUID(),
            sourceContentHash: snapshotBlob.contentHash,
            extractionId: randomUUID(),
            extractionDigest: `sha256:${"c".repeat(64)}`,
            extractorProfileVersion: "p0-deterministic-v1",
          },
        ]),
        JSON.stringify({
          assets: {
            entries: [{ assetId: "logo", contentHash: manifestBlob.contentHash }],
          },
        }),
      ],
    );
    await gc.collect(new Date());
    await expect(store.read(snapshotBlob.relativePath)).resolves.toBeTruthy();
    await expect(store.read(manifestBlob.relativePath)).resolves.toBeTruthy();
  });

  it("终态且过 7 天审计窗的 run 不再保护其引用", async () => {
    const blob = await seedOrphanBlob(uniqueBytes(BRAND_PDF, "stale-run"), "application/pdf");
    const runId = randomUUID();
    await pool.query(
      "INSERT INTO `generation_runs` (`id`, `app_id`, `status`, `brand_source_snapshot`, `created_at`, `updated_at`) VALUES (?, ?, 'succeeded', ?, ?, ?)",
      [
        runId,
        appId,
        JSON.stringify([
          {
            sourceId: randomUUID(),
            sourceContentHash: blob.contentHash,
            extractionId: randomUUID(),
            extractionDigest: `sha256:${"d".repeat(64)}`,
            extractorProfileVersion: "p0-deterministic-v1",
          },
        ]),
        new Date(Date.now() - 8 * DAY_MS),
        new Date(Date.now() - 8 * DAY_MS),
      ],
    );
    const report = await gc.collect(new Date());
    expect(report.deletedBlobs).toBeGreaterThanOrEqual(1);
    await expect(store.read(blob.relativePath)).rejects.toThrow();
  });

  it("Draft 与 Published 的 Bundle Manifest 均保护", async () => {
    const draftBlob = await seedOrphanBlob(uniqueBytes(TINY_RED_PNG, "draft"), "image/png");
    const publishedBlob = await seedOrphanBlob(uniqueBytes(GRADIENT_PNG, "published"), "image/png");
    const runId = randomUUID();
    await pool.query(
      "INSERT INTO `generation_runs` (`id`, `app_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, 'succeeded', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [runId, appId],
    );
    await pool.query(
      "INSERT INTO `draft_versions` (`id`, `app_id`, `generation_run_id`, `spec`, `status`, `bundle`, `created_at`) VALUES (?, ?, ?, '{}', 'ready', ?, UTC_TIMESTAMP(3))",
      [
        randomUUID(),
        appId,
        runId,
        JSON.stringify({
          assets: { entries: [{ assetId: "icon", contentHash: draftBlob.contentHash }] },
        }),
      ],
    );
    await pool.query(
      "INSERT INTO `published_versions` (`id`, `app_id`, `spec`, `bundle`, `published_by_membership_id`, `published_at`) VALUES (?, ?, '{}', ?, ?, UTC_TIMESTAMP(3))",
      [
        randomUUID(),
        appId,
        JSON.stringify({
          assets: { entries: [{ assetId: "hero", contentHash: publishedBlob.contentHash }] },
        }),
        membershipId,
      ],
    );
    await gc.collect(new Date());
    await expect(store.read(draftBlob.relativePath)).resolves.toBeTruthy();
    await expect(store.read(publishedBlob.relativePath)).resolves.toBeTruthy();
  });
});
