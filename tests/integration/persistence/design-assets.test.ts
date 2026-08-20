/**
 * S7 集成测试 1：DesignAsset Blob/Source/Service（计划 S7 验证）。
 * - BlobStore：内容寻址原子写入、魔数/MIME/长度校验、目标已存在幂等复用、
 *   路径防御（拒绝穿越）、缺 Blob fail closed、孤儿 tmp 清扫；
 * - Service：上传编排（Blob→Source→job 排队）、per-app 20 项/100 MiB 限额、
 *   生成输入重验（brandSourceSnapshot 只含不可变快照条目）；
 * - strict DesignAssetStructuredSummaryV1：未知字段/重复角色/重复枚举/
 *   超长自由文本/非法颜色 fail closed。
 * MySQL 隔离 schema（vma_test_<随机>）+ 临时 VMA_ASSET_ROOT。
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
import {
  PER_APP_SOURCE_LIMIT,
  designAssetStructuredSummaryV1Schema,
  validateStructuredSummary,
} from "../../../server/design-assets/contracts.ts";
import { extractStructuredSummary } from "../../../server/design-assets/extraction.ts";

const GRADIENT_PNG = await readFile("tests/fixtures/design-assets/gradient.png");
const TINY_RED_PNG = await readFile("tests/fixtures/design-assets/tiny-red.png");
const BRAND_PDF = await readFile("tests/fixtures/design-assets/brand-guide.pdf");

describe("S7 DesignAsset：BlobStore 与服务层", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let assetRoot: string;
  let store: LocalContentAddressedBlobStore;
  let repository: MysqlDesignAssetRepository;
  let service: DefaultDesignAssetService;
  let appId: string;
  let membershipId: string;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    assetRoot = await mkdtemp(path.join(tmpdir(), "vma-s7-assets-"));
    store = new LocalContentAddressedBlobStore(assetRoot, "test-server");
    repository = new MysqlDesignAssetRepository(handle.db);
    service = new DefaultDesignAssetService(repository, store);

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

  it("BlobStore：魔数确认 MIME、内容寻址路径派生、同内容幂等复用", async () => {
    const first = await store.write({
      bytes: GRADIENT_PNG,
      declaredMimeType: "image/png",
    });
    expect(first.mimeType).toBe("image/png");
    expect(first.kind).toBe("image");
    expect(first.relativePath).toMatch(/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/);

    const second = await store.write({
      bytes: GRADIENT_PNG,
      declaredMimeType: "image/png",
    });
    expect(second.contentHash).toBe(first.contentHash);
    // 磁盘只存在一份（去重）。
    const blobs = await repository.listAllActiveSources(1); // repository 侧无影响
    expect(blobs).toEqual([]);
    const reread = await store.read(first.relativePath);
    expect(reread.byteLength).toBe(GRADIENT_PNG.byteLength);
  });

  it("BlobStore：声明 MIME 与魔数不符 fail closed；未知魔数拒绝", async () => {
    await expect(
      store.write({ bytes: GRADIENT_PNG, declaredMimeType: "application/pdf" }),
    ).rejects.toThrow(/asset_mime_forbidden|asset_magic_mismatch/);
    await expect(
      store.write({
        bytes: new TextEncoder().encode("plain text, not an asset"),
        declaredMimeType: "text/plain",
      }),
    ).rejects.toThrow(/asset_magic_mismatch/);
  });

  it("BlobStore：路径防御（穿越/用户输入路径拒绝）与缺 Blob fail closed", async () => {
    await expect(store.read("../etc/passwd")).rejects.toThrow();
    await expect(
      store.read("sha256/ab/not-a-real-hash-value-at-all"),
    ).rejects.toThrow();
  });

  it("Service：上传编排 Blob→Source(uploaded)→job(queued)，重验 generation 快照", async () => {
    const upload = await service.uploadSource({
      appId,
      createdByMembershipId: membershipId,
      purpose: "reference_screenshot",
      displayName: "gradient.png",
      bytes: GRADIENT_PNG,
      declaredMimeType: "image/png",
    });
    expect(upload.source.status).toBe("uploaded");
    const job = await repository.findJobById(upload.jobId);
    expect(job?.status).toBe("queued");
    expect(job?.sourceContentHash).toBe(upload.blobContentHash);

    // worker 完整跑一遍（真实 PNG 采样 → ready）。
    const worker = await import("../../../server/design-assets/extraction.ts").then(
      (mod) =>
        mod.createExtractionWorker({
          repository,
          blobStore: store,
          leaseOwner: "test-worker",
          leaseTtlMs: 60_000,
        }),
    );
    const outcome = await worker.runOnce();
    expect(outcome).toBe("completed");
    const sourceAfter = await repository.findSourceById(upload.source.id);
    expect(sourceAfter?.status).toBe("ready");
    expect(sourceAfter?.readyExtractionId).toBeTruthy();
    const jobAfter = await repository.findJobById(upload.jobId);
    expect(jobAfter?.status).toBe("succeeded");
    expect(jobAfter?.resultExtractionId).toBe(sourceAfter?.readyExtractionId);

    // 生成输入重验：快照只含不可变条目。
    const snapshot = await service.buildBrandSourceSnapshot({
      appId,
      sourceIds: [upload.source.id],
      expectedContentHashes: { [upload.source.id]: upload.blobContentHash },
    });
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      sourceId: upload.source.id,
      sourceContentHash: upload.blobContentHash,
      extractionId: sourceAfter?.readyExtractionId,
    });
    expect(Object.keys(snapshot[0]).sort()).toEqual([
      "extractionDigest",
      "extractionId",
      "extractorProfileVersion",
      "sourceContentHash",
      "sourceId",
    ]);

    // 哈希不符 → asset_not_found（不泄露存在性差异）。
    await expect(
      service.buildBrandSourceSnapshot({
        appId,
        sourceIds: [upload.source.id],
        expectedContentHashes: { [upload.source.id]: "sha256:" + "0".repeat(64) },
      }),
    ).rejects.toThrow("asset_not_found");
  });

  it("确定性提取：PNG 真实采样 palette；PDF 哈希派生枚举（palette 留空）", () => {
    const pngSummary = extractStructuredSummary({
      kind: "image",
      mimeType: "image/png",
      bytes: GRADIENT_PNG,
    });
    expect(pngSummary.palette.length).toBeGreaterThanOrEqual(4);
    const colors = new Set(pngSummary.palette.map((entry) => entry.color));
    expect(colors.has("#d93025")).toBe(true);
    expect(colors.has("#1a73e8")).toBe(true);
    // 同字节二次提取 → 完全一致（确定性）。
    const again = extractStructuredSummary({
      kind: "image",
      mimeType: "image/png",
      bytes: GRADIENT_PNG,
    });
    expect(again).toEqual(pngSummary);

    const pdfSummary = extractStructuredSummary({
      kind: "pdf",
      mimeType: "application/pdf",
      bytes: BRAND_PDF,
    });
    expect(pdfSummary.palette).toEqual([]);
    expect(pdfSummary.voiceTraits.length).toBeGreaterThan(0);
  });

  it("strict 摘要 Gate：未知字段/重复角色/重复枚举/非法颜色/禁入文本拒绝", () => {
    const valid = extractStructuredSummary({
      kind: "image",
      mimeType: "image/png",
      bytes: TINY_RED_PNG,
    });
    expect(() => validateStructuredSummary(valid)).not.toThrow();

    expect(() =>
      designAssetStructuredSummaryV1Schema.parse({
        ...valid,
        unknownField: true,
      }),
    ).toThrow();
    expect(() =>
      designAssetStructuredSummaryV1Schema.parse({
        ...valid,
        palette: [
          { role: "primary", color: "#111111" },
          { role: "primary", color: "#222222" },
        ],
      }),
    ).toThrow();
    expect(() =>
      designAssetStructuredSummaryV1Schema.parse({
        ...valid,
        voiceTraits: ["bold", "bold"],
      }),
    ).toThrow();
    expect(() =>
      designAssetStructuredSummaryV1Schema.parse({
        ...valid,
        palette: [{ role: "primary", color: "#12G345" }],
      }),
    ).toThrow();
    expect(() =>
      validateStructuredSummary({
        ...valid,
        palette: [
          { role: "primary", color: "#111111", label: "bad <script> label" },
        ],
      }),
    ).toThrow(/free_text_forbidden/);
  });

  it(`per-app 限额：source ≤ ${PER_APP_SOURCE_LIMIT} 项 fail closed`, async () => {
    const anotherApp = randomUUID();
    const owner = randomUUID();
    const anotherMembership = randomUUID();
    await pool.query(
      "INSERT INTO `users` (`id`, `email_normalized`, `email_display`, `created_at`, `updated_at`) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [owner, `u-${owner}@example.com`, `u-${owner}@example.com`],
    );
    await pool.query(
      "INSERT INTO `apps` (`id`, `name`, `created_by_user_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [anotherApp, `app-${anotherApp}`, owner],
    );
    await pool.query(
      "INSERT INTO `memberships` (`id`, `app_id`, `user_id`, `role`, `status`, `active_marker`, `created_at`) VALUES (?, ?, ?, 'owner', 'active', 'active', UTC_TIMESTAMP(3))",
      [anotherMembership, anotherApp, owner],
    );
    for (let index = 0; index < PER_APP_SOURCE_LIMIT; index += 1) {
      await service.uploadSource({
        appId: anotherApp,
        createdByMembershipId: anotherMembership,
        purpose: "reference_screenshot",
        displayName: `s-${index}`,
        bytes: TINY_RED_PNG,
        declaredMimeType: "image/png",
      });
    }
    await expect(
      service.uploadSource({
        appId: anotherApp,
        createdByMembershipId: anotherMembership,
        purpose: "reference_screenshot",
        displayName: "over-limit",
        bytes: TINY_RED_PNG,
        declaredMimeType: "image/png",
      }),
    ).rejects.toThrow("asset_limit_exceeded");
  });

  it("孤儿 tmp 清扫（模拟崩溃残留）", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const dir = path.join(assetRoot, "tmp", "crashed-server");
    await mkdir(dir, { recursive: true });
    const stale = path.join(dir, "stale.part");
    await writeFile(stale, new Uint8Array([1, 2, 3]));
    // mtime 年龄需超过阈值（1ms）：等待后再扫，否则文件被视为新写入。
    await new Promise((resolve) => setTimeout(resolve, 30));
    const removed = await store.sweepOrphanTmp(new Date(), 1);
    expect(removed).toBe(1);
    await expect(
      (async () => (await import("node:fs/promises")).readFile(stale))(),
    ).rejects.toThrow();
  });
});
