import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  memberships,
  previewSelections,
  type PreviewSelectionRow,
} from "../db/schema.ts";

/**
 * PreviewSelection Repository（设计 §13.2.3）：
 * - (appId,membershipId) 唯一；kind='draft' 保存 versionId/revision，
 *   empty/published 不保存（CHECK 约束兜底）；
 * - published 只表示跟随 ReleasePointer，不引用具体 PublishedVersion；
 * - 写入前验证 Membership 属于同一 app（数据库外键 + 应用侧核对）；
 * - 所有写操作使用数据库时间（UTC_TIMESTAMP(3)），条件更新 fail closed。
 */
export type PreviewSelectionKind = "empty" | "published" | "draft";

export interface PreviewSelectionRepository {
  findSelection(
    appId: string,
    membershipId: string,
  ): Promise<PreviewSelectionRow | null>;
  /** upsert 选择；kind=draft 必须提供 versionId/revision，其他 kind 不得提供。 */
  upsertSelection(input: {
    appId: string;
    membershipId: string;
    kind: PreviewSelectionKind;
    versionId?: string;
    revision?: number;
  }): Promise<void>;
  /** 删除 Draft 时引用该 Draft 的选择回退到 published（条件更新）。 */
  fallbackDraftSelections(input: {
    appId: string;
    draftVersionId: string;
  }): Promise<number>;
}

export class MysqlPreviewSelectionRepository
  implements PreviewSelectionRepository
{
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async findSelection(
    appId: string,
    membershipId: string,
  ): Promise<PreviewSelectionRow | null> {
    const rows = await this.db
      .select()
      .from(previewSelections)
      .where(
        and(
          eq(previewSelections.appId, appId),
          eq(previewSelections.membershipId, membershipId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertSelection(input: {
    appId: string;
    membershipId: string;
    kind: PreviewSelectionKind;
    versionId?: string;
    revision?: number;
  }): Promise<void> {
    if (input.kind === "draft") {
      if (!input.versionId || input.revision === undefined) {
        throw new Error("draft 选择必须提供 versionId/revision");
      }
    } else if (input.versionId !== undefined || input.revision !== undefined) {
      throw new Error("empty/published 选择不得携带 versionId/revision");
    }
    // Membership 必须属于同一 app（外键之外的同应用核对，fail closed）
    const membership = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.id, input.membershipId),
          eq(memberships.appId, input.appId),
        ),
      )
      .limit(1);
    if (membership.length === 0) {
      throw new Error("Membership 不属于该应用（preview_selection_membership_mismatch）");
    }
    const versionId = input.kind === "draft" ? (input.versionId ?? null) : null;
    const revision = input.kind === "draft" ? (input.revision ?? null) : null;
    await this.db
      .insert(previewSelections)
      .values({
        appId: input.appId,
        membershipId: input.membershipId,
        kind: input.kind,
        versionId,
        revision,
        updatedAt: sql`UTC_TIMESTAMP(3)`,
      })
      .onDuplicateKeyUpdate({
        set: {
          kind: input.kind,
          versionId,
          revision,
          updatedAt: sql`UTC_TIMESTAMP(3)`,
        },
      });
  }

  async fallbackDraftSelections(input: {
    appId: string;
    draftVersionId: string;
  }): Promise<number> {
    const [result] = await this.db
      .update(previewSelections)
      .set({
        kind: "published",
        versionId: null,
        revision: null,
        updatedAt: sql`UTC_TIMESTAMP(3)`,
      })
      .where(
        and(
          eq(previewSelections.appId, input.appId),
          eq(previewSelections.kind, "draft"),
          eq(previewSelections.versionId, input.draftVersionId),
        ),
      );
    return result.affectedRows;
  }
}
