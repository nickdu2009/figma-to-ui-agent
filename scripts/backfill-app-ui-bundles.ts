/**
 * S13 兼容回填脚本：将旧版 spec-only 的 draft_versions 和 published_versions
 * 幂等、分批回填为默认 AppUiBundle（设计 §13.2.1/§13.2.3，计划 S13 动作 4）。
 *
 * 核心语义：
 * 1. 每批最多 100 行；
 * 2. 仅扫描 bundle IS NULL 的行；
 * 3. CAS 更新（WHERE id = ? AND revision = ? 或 bundle IS NULL），不持有全表锁；
 * 4. 任意 Catalog / Bundle 校验失败立即停止并报错；
 * 5. CLI 默认 dry-run；实际写入必须同时使用 `--confirm` 与显式
 *    `VMA_PROTOCOL_MODE=v2`，避免误写本机开发库。
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { and, eq, isNull, sql } from "drizzle-orm";
import { draftVersions, publishedVersions } from "../server/db/schema.ts";
import {
  CATALOG_VERSION,
  SPEC_COMPATIBILITY,
} from "../src/catalog/catalog-contract.ts";
import {
  appUiBundleSchema,
  type AppUiBundle,
} from "../src/catalog/app-ui-bundle.ts";
import { validateBundleGates } from "../src/catalog/bundle-gates.ts";
import {
  DIGEST_VERSION,
  candidateDigest,
  uiBundleDigest,
  businessSchemaDigest,
} from "../server/bundle/digests.ts";
import type { BusinessSchema } from "../server/business-data/schema-contract.ts";

export const BACKFILL_BATCH_LIMIT = 100;

export interface BackfillOptions {
  databaseUrl?: string;
  pool?: mysql.Pool;
  batchLimit?: number;
  /** 编程调用也默认 dry-run；写入必须同时显式 confirm。 */
  dryRun?: boolean;
  confirm?: boolean;
}

export interface BackfillSummary {
  draftsScanned: number;
  draftsUpdated: number;
  publishedScanned: number;
  publishedUpdated: number;
  errors: Array<{ id: string; table: string; message: string }>;
  dryRun: boolean;
}

type JsonObject = Record<string, unknown>;

const LEGACY_STATE_NAMESPACE = "__catalog_legacy_v1";

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstJsonPointerSegment(value: string): string | undefined {
  if (!value.startsWith("/")) return undefined;
  const raw = value.slice(1).split("/", 1)[0];
  if (raw === undefined) return undefined;
  return raw.replaceAll("~1", "/").replaceAll("~0", "~");
}

function assertNoLegacyStateReference(
  value: unknown,
  legacyKeys: ReadonlySet<string>,
  fieldName?: string,
): void {
  if (typeof value === "string") {
    // 仅检查 runtime 合同定义为 state JSON Pointer 的字段。普通字符串（例如
    // Link href）即使恰好等于 /tasks 也不是 state 引用，不能误判为阻塞。
    if (
      fieldName === "$state" ||
      fieldName === "$bindState" ||
      fieldName === "statePath" ||
      fieldName === "clearStatePath"
    ) {
      const first = firstJsonPointerSegment(value);
      if (first && legacyKeys.has(first)) {
        throw new Error(
          `旧 state 根路径 ${value} 可能仍被引用，拒绝猜测性回填`,
        );
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertNoLegacyStateReference(entry, legacyKeys);
    return;
  }
  if (isJsonObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "watch" && isJsonObject(entry)) {
        for (const pointer of Object.keys(entry)) {
          const first = firstJsonPointerSegment(pointer);
          if (first && legacyKeys.has(first)) {
            throw new Error(
              `旧 state 根路径 ${pointer} 可能仍被 watch 引用，拒绝猜测性回填`,
            );
          }
        }
      }
      assertNoLegacyStateReference(entry, legacyKeys, key);
    }
  }
}

/**
 * 对旧 spec 生成 Bundle 专用的无损投影：历史 spec 永不修改。若任意 state
 * 作用域含有 Bundle v1 不允许的根键，则将其封存到 ui.__catalog_legacy_v1；
 * 若发现可能指向这些根键的 JSON Pointer，一律拒绝而不猜测改写。
 */
export function projectLegacySpecToBundleSpec(spec: unknown): unknown {
  const projected = structuredClone(spec);
  if (!isJsonObject(projected)) return projected;

  const stateHolders: JsonObject[] = [projected];
  const routes = projected.routes;
  if (isJsonObject(routes)) {
    for (const route of Object.values(routes)) {
      if (!isJsonObject(route)) continue;
      for (const key of ["page", "loading", "error", "notFound"] as const) {
        const tree = route[key];
        if (isJsonObject(tree)) stateHolders.push(tree);
      }
    }
  }
  const layouts = projected.layouts;
  if (isJsonObject(layouts)) {
    for (const layout of Object.values(layouts)) {
      if (isJsonObject(layout)) stateHolders.push(layout);
    }
  }

  for (const holder of stateHolders) {
    const state = holder.state;
    if (!isJsonObject(state)) continue;
    const legacyKeys = Object.keys(state).filter((key) => key !== "ui");
    if (legacyKeys.length === 0) continue;

    const ui = state.ui;
    if (ui !== undefined && !isJsonObject(ui)) {
      throw new Error("旧 state.ui 不是对象，无法无损封存 legacy state");
    }
    if (ui && Object.hasOwn(ui, LEGACY_STATE_NAMESPACE)) {
      throw new Error(`旧 state.ui 已占用 ${LEGACY_STATE_NAMESPACE} 命名空间`);
    }

    assertNoLegacyStateReference(projected, new Set(legacyKeys));
    const legacyState = Object.fromEntries(
      legacyKeys.map((key) => [key, state[key]]),
    );
    holder.state = {
      ui: {
        ...(ui ?? {}),
        [LEGACY_STATE_NAMESPACE]: legacyState,
      },
    };
  }

  return projected;
}

export function constructDefaultBundle(spec: unknown): AppUiBundle {
  const bundle: AppUiBundle = {
    bundleVersion: 1,
    catalogVersion: CATALOG_VERSION,
    specCompatibility: SPEC_COMPATIBILITY,
    spec: projectLegacySpecToBundleSpec(spec) as AppUiBundle["spec"],
    designSystem: {
      tokens: { primitive: {}, semantic: {}, component: {} },
      applicationCss: "",
    },
    assets: { entries: [] },
  };

  const parsed = appUiBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    throw new Error(`回填 Bundle 结构无效: ${parsed.error.message}`);
  }

  const gateRes = validateBundleGates(parsed.data);
  if (!gateRes.ok) {
    throw new Error(`回填 Bundle 未通过门禁: ${gateRes.code}`);
  }

  return parsed.data;
}

export async function runBundleBackfill(
  options: BackfillOptions = {},
): Promise<BackfillSummary> {
  const pool =
    options.pool ??
    mysql.createPool(
      options.databaseUrl ??
        process.env.VMA_DATABASE_URL ??
        "mysql://vma:vma-local-dev-only@127.0.0.1:3317/vite_multipage_agent",
    );
  const db = drizzle(pool);
  const limit = options.batchLimit ?? BACKFILL_BATCH_LIMIT;
  const dryRun = options.dryRun ?? !options.confirm;
  if (!dryRun && !options.confirm) {
    throw new Error("实际回填要求显式 confirm=true");
  }

  const summary: BackfillSummary = {
    draftsScanned: 0,
    draftsUpdated: 0,
    publishedScanned: 0,
    publishedUpdated: 0,
    errors: [],
    dryRun,
  };

  const shouldClosePool = !options.pool;

  try {
    // 1. 回填 draft_versions
    const unbackfilledDrafts = await db
      .select({
        id: draftVersions.id,
        revision: draftVersions.revision,
        spec: draftVersions.spec,
        businessSchema: draftVersions.businessSchema,
      })
      .from(draftVersions)
      .where(isNull(draftVersions.bundle))
      .limit(limit);

    summary.draftsScanned = unbackfilledDrafts.length;

    for (const row of unbackfilledDrafts) {
      try {
        const bundle = constructDefaultBundle(row.spec);
        const bDigest = uiBundleDigest(bundle);
        const schema = (row.businessSchema as BusinessSchema | null) ?? null;
        const schemaDig = schema
          ? businessSchemaDigest(schema)
          : "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        const cDigest = candidateDigest({
          uiBundle: bundle,
          businessSchema: schema,
          migrationEdge: {
            fromPublishedVersionId: null,
            fromSchemaDigest: schemaDig,
            toSchemaDigest: schemaDig,
          },
        });

        if (dryRun) continue;
        const [result] = await db
          .update(draftVersions)
          .set({
            bundle,
            catalogVersion: CATALOG_VERSION,
            uiBundleDigest: bDigest,
            candidateDigest: sql`COALESCE(${draftVersions.candidateDigest}, ${cDigest})`,
            digestVersion: DIGEST_VERSION,
          })
          .where(
            and(
              eq(draftVersions.id, row.id),
              eq(draftVersions.revision, row.revision),
              isNull(draftVersions.bundle),
            ),
          );

        const affected =
          (result as { affectedRows?: number }).affectedRows ?? 0;
        if (affected > 0) {
          summary.draftsUpdated += 1;
        }
      } catch (err) {
        summary.errors.push({
          id: row.id,
          table: "draft_versions",
          message: err instanceof Error ? err.message : String(err),
        });
        throw new Error(
          `回填 Draft 失败 [${row.id}]: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }

    // 2. 回填 published_versions
    const unbackfilledPublished = await db
      .select({
        id: publishedVersions.id,
        spec: publishedVersions.spec,
        businessSchema: publishedVersions.businessSchema,
      })
      .from(publishedVersions)
      .where(isNull(publishedVersions.bundle))
      .limit(limit);

    summary.publishedScanned = unbackfilledPublished.length;

    for (const row of unbackfilledPublished) {
      try {
        const bundle = constructDefaultBundle(row.spec);
        const bDigest = uiBundleDigest(bundle);
        const schema = (row.businessSchema as BusinessSchema | null) ?? null;
        const schemaDig = schema
          ? businessSchemaDigest(schema)
          : "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        const cDigest = candidateDigest({
          uiBundle: bundle,
          businessSchema: schema,
          migrationEdge: {
            fromPublishedVersionId: null,
            fromSchemaDigest: schemaDig,
            toSchemaDigest: schemaDig,
          },
        });

        if (dryRun) continue;
        const [result] = await db
          .update(publishedVersions)
          .set({
            bundle,
            catalogVersion: CATALOG_VERSION,
            uiBundleDigest: bDigest,
            candidateDigest: sql`COALESCE(${publishedVersions.candidateDigest}, ${cDigest})`,
            digestVersion: DIGEST_VERSION,
          })
          .where(
            and(
              eq(publishedVersions.id, row.id),
              isNull(publishedVersions.bundle),
            ),
          );

        const affected =
          (result as { affectedRows?: number }).affectedRows ?? 0;
        if (affected > 0) {
          summary.publishedUpdated += 1;
        }
      } catch (err) {
        summary.errors.push({
          id: row.id,
          table: "published_versions",
          message: err instanceof Error ? err.message : String(err),
        });
        throw new Error(
          `回填 Published 失败 [${row.id}]: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }

    return summary;
  } finally {
    if (shouldClosePool) {
      await pool.end();
    }
  }
}

// 命令行直接执行
if (import.meta.url === `file://${process.argv[1]}`) {
  const confirmed = process.argv.slice(2).includes("--confirm");
  const mode = process.env.VMA_PROTOCOL_MODE?.trim().toLowerCase();
  if (confirmed && mode !== "v2") {
    console.error(
      "[backfill-fatal] 实际回填要求显式 VMA_PROTOCOL_MODE=v2 与 --confirm",
    );
    process.exit(2);
  }
  runBundleBackfill({ dryRun: !confirmed, confirm: confirmed })
    .then((summary) => {
      console.log("[backfill-summary]", JSON.stringify(summary, null, 2));
      if (summary.errors.length > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("[backfill-fatal]", err);
      process.exit(1);
    });
}
