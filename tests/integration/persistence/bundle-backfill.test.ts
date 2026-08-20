/**
 * S13 集成测试：Bundle 兼容回填脚本与幂等零缺口验证（设计 §13.2.1/§13.2.3）。
 *
 * 验证：
 * 1. 扫描 bundle IS NULL 的草稿与发布行；
 * 2. 构造合法默认 AppUiBundle 并通过门禁校验；
 * 3. CAS 更新落库（catalogVersion, uiBundleDigest, candidateDigest, digestVersion）；
 * 4. 再次运行实现零缺口（0 行待回填）。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import {
  runBundleBackfill,
  constructDefaultBundle,
  projectLegacySpecToBundleSpec,
} from "../../../scripts/backfill-app-ui-bundles.ts";
import { CATALOG_VERSION } from "../../../src/catalog/catalog-contract.ts";

interface Seed {
  appId: string;
  userId: string;
  membershipId: string;
}

async function seedApp(pool: mysql.Pool): Promise<Seed> {
  const userId = randomUUID();
  const appId = randomUUID();
  const membershipId = randomUUID();
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
  return { appId, userId, membershipId };
}

const LEGACY_SPEC = {
  metadata: { title: { default: "Legacy App", template: "%s" } },
  routes: {
    "/": {
      page: {
        root: "r1",
        elements: {
          r1: {
            type: "Heading",
            props: { text: "Legacy Spec", level: "h1", className: null },
            children: [],
          },
        },
      },
    },
  },
  state: { ui: {} },
};

describe("S13 Bundle 兼容回填集成测试", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let seed: Seed;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    seed = await seedApp(pool);
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("constructDefaultBundle 生成合法默认 AppUiBundle", () => {
    const bundle = constructDefaultBundle(LEGACY_SPEC);
    expect(bundle.bundleVersion).toBe(1);
    expect(bundle.catalogVersion).toBe(CATALOG_VERSION);
    expect(bundle.spec).toEqual(LEGACY_SPEC);
    expect(bundle.designSystem.tokens).toEqual({
      primitive: {},
      semantic: {},
      component: {},
    });
  });

  it("无损封存旧 state 根命名空间，且不修改历史 spec", () => {
    const legacy = structuredClone(LEGACY_SPEC) as Record<string, unknown>;
    legacy.state = { ui: { theme: "dark" }, tasks: [{ id: "t1" }] };
    const routes = legacy.routes as Record<string, Record<string, unknown>>;
    const page = routes["/"]!.page as Record<string, unknown>;
    page.state = { task1Done: true };
    const sourceBefore = structuredClone(legacy);

    const bundle = constructDefaultBundle(legacy);
    expect(legacy).toEqual(sourceBefore);
    expect(bundle.spec.state).toEqual({
      ui: {
        theme: "dark",
        __catalog_legacy_v1: { tasks: [{ id: "t1" }] },
      },
    });
    expect(bundle.spec.routes["/"]!.page.state).toEqual({
      ui: { __catalog_legacy_v1: { task1Done: true } },
    });
  });

  it("旧 state 根路径疑似仍被引用时失败关闭", () => {
    const legacy = structuredClone(LEGACY_SPEC) as Record<string, unknown>;
    legacy.state = { ui: {}, tasks: [] };
    const routes = legacy.routes as Record<string, Record<string, unknown>>;
    const page = routes["/"]!.page as Record<string, unknown>;
    const elements = page.elements as Record<string, Record<string, unknown>>;
    elements.r1!.props = { text: { $state: "/tasks/0" } };

    expect(() => projectLegacySpecToBundleSpec(legacy)).toThrow(
      "旧 state 根路径 /tasks/0 可能仍被引用",
    );
  });

  it("普通 Link href 不会被误判为 state JSON Pointer", () => {
    const legacy = structuredClone(LEGACY_SPEC) as Record<string, unknown>;
    legacy.state = { ui: {}, tasks: [] };
    const routes = legacy.routes as Record<string, Record<string, unknown>>;
    const page = routes["/"]!.page as Record<string, unknown>;
    const elements = page.elements as Record<string, Record<string, unknown>>;
    elements.r1!.type = "Link";
    elements.r1!.props = { href: "/tasks", children: "Tasks" };

    expect(constructDefaultBundle(legacy).spec.state).toEqual({
      ui: { __catalog_legacy_v1: { tasks: [] } },
    });
  });

  it("runBundleBackfill 批量回填草稿与发布版本并达到零缺口", async () => {
    const draftId1 = randomUUID();
    const draftId2 = randomUUID();
    const publishedId1 = randomUUID();

    // 播种 bundle IS NULL 的旧版本行
    await pool.query(
      "INSERT INTO `draft_versions` (`id`, `app_id`, `generation_run_id`, `spec`, `status`, `created_at`, `revision`) VALUES (?, ?, ?, ?, 'ready', UTC_TIMESTAMP(3), 1)",
      [draftId1, seed.appId, randomUUID(), JSON.stringify(LEGACY_SPEC)],
    );
    await pool.query(
      "INSERT INTO `draft_versions` (`id`, `app_id`, `generation_run_id`, `spec`, `status`, `created_at`, `revision`) VALUES (?, ?, ?, ?, 'ready', UTC_TIMESTAMP(3), 1)",
      [draftId2, seed.appId, randomUUID(), JSON.stringify(LEGACY_SPEC)],
    );
    await pool.query(
      "INSERT INTO `published_versions` (`id`, `app_id`, `draft_version_id`, `published_by_membership_id`, `spec`, `published_at`) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [
        publishedId1,
        seed.appId,
        draftId1,
        seed.membershipId,
        JSON.stringify(LEGACY_SPEC),
      ],
    );

    // 默认 dry-run：只扫描，不得写入。
    const dryRun = await runBundleBackfill({ pool, batchLimit: 50 });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.draftsScanned).toBe(2);
    expect(dryRun.publishedScanned).toBe(1);
    expect(dryRun.draftsUpdated).toBe(0);
    expect(dryRun.publishedUpdated).toBe(0);

    // 显式确认后执行回填
    const summary = await runBundleBackfill({
      pool,
      batchLimit: 50,
      confirm: true,
    });
    expect(summary.errors).toHaveLength(0);
    expect(summary.draftsUpdated).toBe(2);
    expect(summary.publishedUpdated).toBe(1);

    // 验证草稿行已被回填
    const [draftRows] = await pool.query(
      "SELECT `id`, `bundle`, `catalog_version`, `ui_bundle_digest`, `candidate_digest` FROM `draft_versions` WHERE `id` IN (?, ?)",
      [draftId1, draftId2],
    );
    const drafts = draftRows as Array<Record<string, unknown>>;
    expect(drafts).toHaveLength(2);
    for (const d of drafts) {
      expect(d.bundle).toBeDefined();
      expect(d.catalog_version).toBe(CATALOG_VERSION);
      expect(d.ui_bundle_digest).toBeTruthy();
    }

    // 验证发布行已被回填
    const [pubRows] = await pool.query(
      "SELECT `id`, `bundle`, `catalog_version`, `ui_bundle_digest` FROM `published_versions` WHERE `id` = ?",
      [publishedId1],
    );
    const pub = (pubRows as Array<Record<string, unknown>>)[0];
    expect(pub?.bundle).toBeDefined();
    expect(pub?.catalog_version).toBe(CATALOG_VERSION);
    expect(pub?.ui_bundle_digest).toBeTruthy();

    // 再次执行回填：零缺口扫描（0 行待回填）
    const secondSummary = await runBundleBackfill({
      pool,
      batchLimit: 50,
      confirm: true,
    });
    expect(secondSummary.draftsScanned).toBe(0);
    expect(secondSummary.draftsUpdated).toBe(0);
    expect(secondSummary.publishedScanned).toBe(0);
    expect(secondSummary.publishedUpdated).toBe(0);
  });
});
