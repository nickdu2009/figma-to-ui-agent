/**
 * BusinessActionUnitOfWork（设计 §9.2，计划 S8 动作 3/4）。
 *
 * 写命令在一个 MySQL 事务内按固定锁序执行：
 *   1. ReleasePointer（FOR UPDATE）——同一事务快照核对 header 版本；
 *   2. (appId,membershipId,canonicalActionName,idempotencyKey) ledger claim；
 *   3. 目标业务记录/投影 mutation + ledger 终态。
 *
 * 崩溃语义：提交前进程崩溃 → 整体回滚（无孤立 pending）；提交后响应丢失 →
 * 重放路径重新鉴权后从 resultRef 投影，不重放 mutation。
 *
 * executor 只能通过本模块拿到 tx 并调用 Repository 的 *InTransaction 原语；
 * 禁止在 executor 内再自行开启事务（嵌套事务）。
 */
import { conflict, HttpError } from "../middleware/errors.ts";
import type { Database } from "../persistence/database.ts";
import type { UnitOfWork } from "../repositories/business-action-idempotency-repository.ts";
import type { ReleasePointerRow } from "../db/schema.ts";
import type { MysqlReleaseRepository } from "../repositories/release-repository.ts";
import { BusinessActionError } from "./contracts.ts";

export class PublishedVersionChangedError extends BusinessActionError {
  constructor() {
    super(409, "published_version_changed", "发布版本已变化，请刷新后重试");
    this.name = "PublishedVersionChangedError";
  }
}

/**
 * 在 UoW 事务内锁定 ReleasePointer 并核对宿主 header 版本。
 * 返回锁定的指针行；无指针/错配均 fail closed（不写不读业务数据）。
 */
export async function lockAndVerifyReleasePointer(input: {
  tx: UnitOfWork;
  releaseRepository: MysqlReleaseRepository;
  appId: string;
  /** 宿主附加的 X-VMA-Published-Version（已与 body.publishedVersionId 相同）。 */
  expectedPublishedVersionId: string;
}): Promise<ReleasePointerRow> {
  const pointer = await input.releaseRepository.lockReleasePointerInTransaction(
    input.tx,
    input.appId,
  );
  if (!pointer) {
    throw new BusinessActionError(404, "schema_not_found", "当前应用尚未发布");
  }
  if (pointer.publishedVersionId !== input.expectedPublishedVersionId) {
    throw new PublishedVersionChangedError();
  }
  return pointer;
}

/** 以共享 UoW 运行写命令体；body 内部只允许 *InTransaction 原语。 */
export async function runInBusinessActionUoW<T>(
  db: Database,
  body: (tx: UnitOfWork) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => body(tx));
}

/** 409 冲突辅助：保持与既有 /data 行为一致的错误形状。 */
export function revisionConflict(details: {
  currentRevision: number | null;
  current?: unknown;
}): HttpError {
  return new HttpError(409, "revision_conflict", "修订冲突", {
    currentRevision: details.currentRevision,
    ...(details.current === undefined ? {} : { current: details.current }),
  });
}

export { conflict };
