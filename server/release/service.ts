import { conflict, notFound } from "../middleware/errors.ts";
import type { ReleaseRepository } from "../repositories/release-repository.ts";
import {
  dataMigrationPlanSchema,
  parseBusinessSchema,
  type DataMigrationPlan,
} from "../schema-migrations/plan.ts";
import type { SchemaMigrationService } from "../schema-migrations/service.ts";
import {
  validateBusinessSchema,
  type BusinessSchema,
} from "../business-data/schema-contract.ts";

/**
 * 发布服务（S4，设计 §4.2、AC3/AC4）：
 * - 只有 committed 产生的 ready 草稿可发布；生成/草稿永不自动发布；
 * - 发布创建不可变 PublishedVersion 并原子移动 ReleasePointer；
 * - 回滚只移动 ReleasePointer（S4 阶段仅允许同业务 Schema）；
 * - 剪枝保留当前发布版本 + 最近九个其他成功版本（AC4）。
 *
 * S4 Schema 门禁（计划 S4 操作要点）：
 * - 无当前发布版本时，只允许发布空业务 Schema；
 * - 有当前发布版本时，候选业务 Schema 必须与当前已发布 Schema 相同；
 * - 不同 Schema 一律 409 schema_gate（首次非空 Schema 等 S5b 迁移门禁）。
 */

const MAX_RETAINED_PUBLISHED = 10;

/** 空业务 Schema：null/undefined，或无集合定义的对象。 */
export function isEmptyBusinessSchema(schema: unknown): boolean {
  if (schema == null) return true;
  if (typeof schema !== "object") return false;
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.collections)) return record.collections.length === 0;
  return Object.keys(record).length === 0;
}

/** 规范化深比较（键排序的稳定序列化）。 */
export function canonicalBusinessSchema(schema: unknown): string {
  return JSON.stringify(sortKeys(schema ?? null));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortKeys(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export class ReleaseService {
  private readonly releases: ReleaseRepository;
  private readonly migrations?: SchemaMigrationService;
  private readonly requireDirectPredecessor: boolean;

  constructor(
    releases: ReleaseRepository,
    migrations?: SchemaMigrationService,
    options: { requireDirectPredecessor?: boolean } = {},
  ) {
    this.releases = releases;
    this.migrations = migrations;
    this.requireDirectPredecessor = options.requireDirectPredecessor ?? false;
  }

  /** 所有者显式发布（AC3）。 */
  async publish(input: {
    appId: string;
    draftId: string;
    membershipId: string;
    /** @deprecated 仅兼容直接服务调用；HTTP 路由永不接受客户端迁移计划。 */
    migrationPlan?: unknown;
    /** @deprecated 仅兼容直接服务调用；HTTP 路由永不接受客户端迁移计划。 */
    reversePlan?: unknown;
  }): Promise<{ publishedVersionId: string }> {
    const draft = await this.releases.findDraftById(input.draftId);
    if (!draft || draft.appId !== input.appId) throw notFound();
    if (draft.status !== "ready") {
      throw conflict("not_publishable", "草稿不可发布");
    }
    if ((draft as { publishBlocked?: boolean }).publishBlocked) {
      throw conflict("publish_blocked", "草稿包含阻塞性质量问题，禁止发布");
    }
    const pointer = await this.releases.getReleasePointer(input.appId);
    if (pointer) {
      const current = await this.releases.findPublishedVersionById(
        pointer.publishedVersionId,
      );
      if (!current) {
        // 指针悬空：数据完整性失败，fail-closed
        throw conflict("release_integrity", "当前发布指针无效");
      }
      if (
        canonicalBusinessSchema(current.businessSchema) !==
        canonicalBusinessSchema(draft.businessSchema)
      ) {
        // S5b 迁移门禁（设计 §4.4）：跨 Schema 发布必须有经验证的迁移计划
        if (!this.migrations) {
          throw conflict("migration_unavailable", "迁移服务未启用");
        }
        // Candidate 在生成期已由服务端封存并随 Preview Commit 落入 Draft；
        // 发布路由只传 draftId，绝不信任浏览器临时提交的迁移 JSON。
        // 形参 fallback 仅保留给旧的服务层测试/调用，不能从 HTTP 到达。
        const storedPlan = draft.migrationPlan ?? input.migrationPlan;
        const storedReversePlan = draft.reversePlan ?? input.reversePlan;
        if (!storedPlan) {
          throw conflict(
            "migration_plan_required",
            "跨业务 Schema 发布缺少服务端封存的 DataMigrationPlan",
          );
        }
        if (
          this.requireDirectPredecessor &&
          draft.migrationFromPublishedVersionId !== null &&
          draft.migrationFromPublishedVersionId !== current.id
        ) {
          throw conflict(
            "migration_predecessor_mismatch",
            "草稿的迁移前序版本不是当前发布版本",
          );
        }
        const plan: DataMigrationPlan = dataMigrationPlanSchema.parse(storedPlan);
        const reversePlan = storedReversePlan
          ? dataMigrationPlanSchema.parse(storedReversePlan)
          : null;
        const fromSchema: BusinessSchema =
          current.businessSchema == null
            ? { collections: [] }
            : validateBusinessSchema(current.businessSchema);
        const toSchema = validateBusinessSchema(draft.businessSchema);
        // 1. 正向计划：对全部记录副本内存验证
        const forward = await this.migrations.validatePlan({
          appId: input.appId,
          fromSchema,
          toSchema,
          plan,
        });
        // 2. 反向计划：对迁移后数据内存验证（可回滚前提）
        if (reversePlan) {
          await this.migrations.validatePlan({
            appId: input.appId,
            fromSchema: toSchema,
            toSchema: fromSchema,
            plan: reversePlan,
            recordsOverride: forward,
          });
        }
        // 3. 原子提交：迁移 + 新版本 + 指针移动同事务
        const result = await this.migrations.applyMigrationAndPublish({
          appId: input.appId,
          draftId: draft.id,
          fromSchema,
          toSchema,
          plan,
          reversePlan,
          publishedByMembershipId: input.membershipId,
          now: new Date(),
        });
        await this.prune(input.appId);
        return result;
      }
    } else {
      // S5b：首次发布允许非空 Schema（尚无业务记录，无迁移风险），
      // 但非空 Schema 必须通过 fail-closed 校验
      if (!isEmptyBusinessSchema(draft.businessSchema)) {
        parseBusinessSchema(draft.businessSchema);
      }
    }
    const result = await this.releases.publishDraft({
      appId: input.appId,
      draftId: draft.id,
      publishedByMembershipId: input.membershipId,
      now: new Date(),
    });
    await this.prune(input.appId);
    return result;
  }

  /** 所有者回滚（同 Schema 移指针；跨 Schema 需经验证的反向计划）。 */
  async rollback(input: {
    appId: string;
    publishedVersionId: string;
    changedByUserId: string;
  }): Promise<void> {
    const pointer = await this.releases.getReleasePointer(input.appId);
    if (!pointer) {
      throw conflict("no_release", "当前没有已发布版本");
    }
    const target = await this.releases.findPublishedVersionById(
      input.publishedVersionId,
    );
    if (!target || target.appId !== input.appId) throw notFound();
    const current = await this.releases.findPublishedVersionById(
      pointer.publishedVersionId,
    );
    if (!current) {
      throw conflict("release_integrity", "当前发布指针无效");
    }
    if (pointer.publishedVersionId === target.id) return; // 幂等
    // ReleasePointer 只能沿服务端记录的 migration edge 回退一个版本；允许
    // 任意历史版本会跳过数据迁移和审计边界。
    if (
      this.requireDirectPredecessor &&
      current.migrationFromPublishedVersionId !== target.id
    ) {
      throw conflict(
        "rollback_predecessor_required",
        "回滚仅允许回到当前版本的受控直接前序",
      );
    }
    if (
      canonicalBusinessSchema(current.businessSchema) !==
      canonicalBusinessSchema(target.businessSchema)
    ) {
      // S5b：跨 Schema 回滚需要当前版本存储的经验证反向计划
      if (!this.migrations) {
        throw conflict("migration_unavailable", "迁移服务未启用");
      }
      if (!current.reversePlan) {
        throw conflict(
          "rollback_not_supported",
          "当前版本没有经验证的反向迁移计划，不可跨 Schema 回滚",
        );
      }
      const reversePlan = dataMigrationPlanSchema.parse(current.reversePlan);
      const fromSchema: BusinessSchema =
        current.businessSchema == null
          ? { collections: [] }
          : validateBusinessSchema(current.businessSchema);
      const toSchema: BusinessSchema =
        target.businessSchema == null
          ? { collections: [] }
          : validateBusinessSchema(target.businessSchema);
      await this.migrations.applyRollbackMigration({
        appId: input.appId,
        fromSchema,
        toSchema,
        reversePlan,
        targetPublishedVersionId: target.id,
        changedByUserId: input.changedByUserId,
        now: new Date(),
      });
      return;
    }
    const moved = await this.releases.rollbackPointer({
      appId: input.appId,
      publishedVersionId: target.id,
      now: new Date(),
    });
    if (!moved) throw conflict("no_release", "当前没有已发布版本");
  }

  /** 剪枝（AC4）：当前发布版本 + 最近九个其他版本；当前永不剪枝。 */
  async prune(appId: string): Promise<number> {
    const versions = await this.releases.listPublishedVersions(appId);
    if (versions.length <= MAX_RETAINED_PUBLISHED) return 0;
    const pointer = await this.releases.getReleasePointer(appId);
    const currentId = pointer?.publishedVersionId ?? null;
    const keep = new Set<string>();
    if (currentId) keep.add(currentId);
    for (const version of versions) {
      if (keep.size >= MAX_RETAINED_PUBLISHED) break;
      keep.add(version.id);
    }
    return this.releases.prunePublishedVersions({
      appId,
      keepIds: [...keep],
    });
  }
}
