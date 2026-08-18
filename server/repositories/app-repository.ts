import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  apps,
  invitations,
  memberships,
  releasePointers,
  type AppRow,
  type InvitationRow,
  type MembershipRow,
  type ReleasePointerRow,
} from "../db/schema.ts";
import {
  isDuplicateEntry,
  NotFoundError,
  RevisionConflictError,
  UniqueConstraintError,
} from "./errors.ts";

/**
 * AppRepository：应用、成员关系、发布指针的唯一事实 owner。
 * S2 扩展邀请接受/成员移除；S4 扩展草稿/发布版本。
 */

export interface AppRepository {
  /**
   * 创建应用并原子建立 owner Membership（同事务，设计 §4.2：
   * 创建者自动成为唯一所有者）。
   */
  createAppWithOwner(input: {
    name: string;
    createdByUserId: string;
  }): Promise<{ app: AppRow; ownerMembership: MembershipRow }>;
  findAppById(id: string): Promise<AppRow | null>;
  findActiveMembership(
    appId: string,
    userId: string,
  ): Promise<MembershipRow | null>;
  /** 应用列表（当前有效成员关系），用于多应用选择/刷新恢复（GATE-00 §4）。 */
  listAppsForUser(
    userId: string,
  ): Promise<Array<{ app: AppRow; membership: MembershipRow }>>;
  /** expectedRevision 条件更新（409 语义）。 */
  renameApp(input: {
    appId: string;
    name: string;
    expectedRevision: number;
  }): Promise<AppRow>;
  getReleasePointer(appId: string): Promise<ReleasePointerRow | null>;
  /**
   * 创建发布指针（首次发布）。已存在时抛 RevisionConflictError——
   * 并发首次发布只允许一个成功。
   */
  createReleasePointer(input: {
    appId: string;
    publishedVersionId: string;
  }): Promise<ReleasePointerRow>;
  /** 移动发布指针（发布/回滚），必须携带 expectedRevision。 */
  moveReleasePointer(input: {
    appId: string;
    publishedVersionId: string;
    expectedRevision: number;
  }): Promise<ReleasePointerRow>;

  // ---------- 邀请与成员（成员域，设计 §4.1/§6.1） ----------

  createInvitation(input: {
    appId: string;
    emailNormalized: string;
    role: "editor" | "viewer";
    createdByUserId: string;
    expiresAt: Date;
  }): Promise<InvitationRow>;
  findInvitationById(id: string): Promise<InvitationRow | null>;
  /** 某邮箱名下仍有效的邀请（用于登录资格判定）。 */
  hasOpenInvitationForEmail(emailNormalized: string): Promise<boolean>;
  listInvitations(appId: string): Promise<InvitationRow[]>;
  /** 条件撤销：仅当未撤销且未接受时生效；返回 false 表示不可撤销。 */
  revokeInvitation(id: string, now: Date): Promise<boolean>;
  /**
   * 原子接受邀请（同事务）：仅当邀请未接受/未撤销/未过期时接受，
   * 并为该用户创建全新的 Membership ID（设计 §4.1：重入不复用旧 ID）。
   * 返回 null 表示邀请不可接受。
   */
  acceptInvitation(input: {
    invitationId: string;
    userId: string;
    now: Date;
  }): Promise<MembershipRow | null>;
  listMemberships(appId: string): Promise<MembershipRow[]>;
  findMembershipById(id: string): Promise<MembershipRow | null>;
  /**
   * 条件移除成员：仅当 active 时停用该 Membership（activeMarker 置 NULL）。
   * 返回 false 表示已移除/不存在。
   */
  removeMembership(id: string, now: Date): Promise<boolean>;
  /** 应用当前 active owner 数量（用于拒绝移除最后一个 owner）。 */
  countActiveOwners(appId: string): Promise<number>;
  /** 软删除应用（回收站）：仅 active → deleted。 */
  softDeleteApp(appId: string, now: Date): Promise<boolean>;
  /** 恢复应用（治理端点）：仅 deleted → active。 */
  restoreApp(appId: string, now: Date): Promise<boolean>;
}

export class MysqlAppRepository implements AppRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async createAppWithOwner(input: {
    name: string;
    createdByUserId: string;
  }): Promise<{ app: AppRow; ownerMembership: MembershipRow }> {
    const now = new Date();
    const app: AppRow = {
      id: randomUUID(),
      name: input.name,
      createdByUserId: input.createdByUserId,
      status: "active",
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    const ownerMembership: MembershipRow = {
      id: randomUUID(),
      appId: app.id,
      userId: input.createdByUserId,
      role: "owner",
      status: "active",
      activeMarker: "active",
      createdAt: now,
      removedAt: null,
      revision: 1,
    };
    return this.db.transaction(async (tx) => {
      await tx.insert(apps).values(app);
      await tx.insert(memberships).values(ownerMembership);
      return { app, ownerMembership };
    });
  }

  async findAppById(id: string): Promise<AppRow | null> {
    const rows = await this.db
      .select()
      .from(apps)
      .where(eq(apps.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveMembership(
    appId: string,
    userId: string,
  ): Promise<MembershipRow | null> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.appId, appId),
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listAppsForUser(
    userId: string,
  ): Promise<Array<{ app: AppRow; membership: MembershipRow }>> {
    const rows = await this.db
      .select({ app: apps, membership: memberships })
      .from(memberships)
      .innerJoin(apps, eq(memberships.appId, apps.id))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
          // 已删除应用在正常流程不可见（设计 §4.5，S5b/S7）
          ne(apps.status, "deleted"),
        ),
      );
    return rows;
  }

  async renameApp(input: {
    appId: string;
    name: string;
    expectedRevision: number;
  }): Promise<AppRow> {
    const [result] = await this.db
      .update(apps)
      .set({
        name: input.name,
        updatedAt: new Date(),
        revision: input.expectedRevision + 1,
      })
      .where(
        and(
          eq(apps.id, input.appId),
          eq(apps.revision, input.expectedRevision),
        ),
      );
    if (result.affectedRows === 0) {
      const existing = await this.findAppById(input.appId);
      if (!existing) throw new NotFoundError("应用不存在");
      throw new RevisionConflictError(
        `应用 revision 冲突：期望 ${input.expectedRevision}，当前 ${existing.revision}`,
      );
    }
    const updated = await this.findAppById(input.appId);
    if (!updated) throw new NotFoundError("应用不存在");
    return updated;
  }

  async getReleasePointer(appId: string): Promise<ReleasePointerRow | null> {
    const rows = await this.db
      .select()
      .from(releasePointers)
      .where(eq(releasePointers.appId, appId))
      .limit(1);
    return rows[0] ?? null;
  }

  async createReleasePointer(input: {
    appId: string;
    publishedVersionId: string;
  }): Promise<ReleasePointerRow> {
    const row: ReleasePointerRow = {
      appId: input.appId,
      publishedVersionId: input.publishedVersionId,
      updatedAt: new Date(),
      revision: 1,
    };
    try {
      await this.db.insert(releasePointers).values(row);
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new RevisionConflictError("发布指针已存在（并发首次发布冲突）", {
          cause: error,
        });
      }
      throw error;
    }
    return row;
  }

  async moveReleasePointer(input: {
    appId: string;
    publishedVersionId: string;
    expectedRevision: number;
  }): Promise<ReleasePointerRow> {
    const [result] = await this.db
      .update(releasePointers)
      .set({
        publishedVersionId: input.publishedVersionId,
        updatedAt: new Date(),
        revision: input.expectedRevision + 1,
      })
      .where(
        and(
          eq(releasePointers.appId, input.appId),
          eq(releasePointers.revision, input.expectedRevision),
        ),
      );
    if (result.affectedRows === 0) {
      const existing = await this.getReleasePointer(input.appId);
      if (!existing) throw new NotFoundError("发布指针不存在");
      throw new RevisionConflictError(
        `发布指针 revision 冲突：期望 ${input.expectedRevision}，当前 ${existing.revision}`,
      );
    }
    const updated = await this.getReleasePointer(input.appId);
    if (!updated) throw new NotFoundError("发布指针不存在");
    return updated;
  }

  // ---------- 邀请与成员 ----------

  async createInvitation(input: {
    appId: string;
    emailNormalized: string;
    role: "editor" | "viewer";
    createdByUserId: string;
    expiresAt: Date;
  }): Promise<InvitationRow> {
    const row: InvitationRow = {
      id: randomUUID(),
      appId: input.appId,
      emailNormalized: input.emailNormalized,
      role: input.role,
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt,
      revokedAt: null,
      acceptedAt: null,
      acceptedMembershipId: null,
      createdAt: new Date(),
      revision: 1,
    };
    await this.db.insert(invitations).values(row);
    return row;
  }

  async findInvitationById(id: string): Promise<InvitationRow | null> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async hasOpenInvitationForEmail(emailNormalized: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.emailNormalized, emailNormalized),
          isNull(invitations.revokedAt),
          isNull(invitations.acceptedAt),
          // 过期邀请不得换取登录资格（评审修复：fail-closed）
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listInvitations(appId: string): Promise<InvitationRow[]> {
    return this.db
      .select()
      .from(invitations)
      .where(eq(invitations.appId, appId))
      .orderBy(desc(invitations.createdAt));
  }

  async revokeInvitation(id: string, now: Date): Promise<boolean> {
    const [result] = await this.db
      .update(invitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(invitations.id, id),
          isNull(invitations.revokedAt),
          isNull(invitations.acceptedAt),
        ),
      );
    return result.affectedRows === 1;
  }

  async acceptInvitation(input: {
    invitationId: string;
    userId: string;
    now: Date;
  }): Promise<MembershipRow | null> {
    return this.db.transaction(async (tx) => {
      const [accepted] = await tx
        .update(invitations)
        .set({ acceptedAt: input.now })
        .where(
          and(
            eq(invitations.id, input.invitationId),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        );
      if (accepted.affectedRows === 0) return null;
      const invitation = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.id, input.invitationId))
        .limit(1);
      const row = invitation[0];
      if (!row || row.expiresAt <= input.now) {
        // 过期邀请不可接受：回滚
        throw new InvitationNotAcceptableError();
      }
      const membership: MembershipRow = {
        id: randomUUID(),
        appId: row.appId,
        userId: input.userId,
        role: row.role,
        status: "active",
        activeMarker: "active",
        createdAt: input.now,
        removedAt: null,
        revision: 1,
      };
      try {
        await tx.insert(memberships).values(membership);
      } catch (error) {
        if (isDuplicateEntry(error)) {
          // 已是该应用 active 成员：同一用户不能重复接受
          throw new InvitationNotAcceptableError();
        }
        throw error;
      }
      await tx
        .update(invitations)
        .set({ acceptedMembershipId: membership.id })
        .where(eq(invitations.id, input.invitationId));
      return membership;
    });
  }

  async listMemberships(appId: string): Promise<MembershipRow[]> {
    return this.db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.appId, appId), eq(memberships.status, "active")),
      )
      .orderBy(asc(memberships.createdAt));
  }

  async findMembershipById(id: string): Promise<MembershipRow | null> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(eq(memberships.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async removeMembership(id: string, now: Date): Promise<boolean> {
    const [result] = await this.db
      .update(memberships)
      .set({ status: "removed", activeMarker: null, removedAt: now })
      .where(and(eq(memberships.id, id), eq(memberships.status, "active")));
    return result.affectedRows === 1;
  }

  /** 软删除应用（回收站）：仅 active → deleted。 */
  async softDeleteApp(appId: string, now: Date): Promise<boolean> {
    const [result] = await this.db
      .update(apps)
      .set({ status: "deleted", deletedAt: now, updatedAt: now })
      .where(and(eq(apps.id, appId), eq(apps.status, "active")));
    return result.affectedRows === 1;
  }

  /** 恢复应用（治理端点）：仅 deleted → active。 */
  async restoreApp(appId: string, now: Date): Promise<boolean> {
    const [result] = await this.db
      .update(apps)
      .set({ status: "active", deletedAt: null, updatedAt: now })
      .where(and(eq(apps.id, appId), eq(apps.status, "deleted")));
    return result.affectedRows === 1;
  }

  async countActiveOwners(appId: string): Promise<number> {
    const rows = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.appId, appId),
          eq(memberships.role, "owner"),
          eq(memberships.status, "active"),
        ),
      );
    return rows.length;
  }
}

/** 邀请不可接受（已接受/已撤销/已过期/已是成员）——服务层映射为失败关闭。 */
export class InvitationNotAcceptableError extends Error {
  readonly code = "invitation_not_acceptable";
  constructor() {
    super("邀请不可接受（已接受、已撤销、已过期或已是成员）");
    this.name = "InvitationNotAcceptableError";
  }
}

export { UniqueConstraintError };
