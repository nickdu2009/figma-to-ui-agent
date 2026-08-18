import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  authChallenges,
  creatorGrants,
  devMailInbox,
  sessions,
  users,
  type AuthChallengeRow,
  type CreatorGrantRow,
  type DevMailInboxRow,
  type SessionRow,
  type UserRow,
} from "../db/schema.ts";
import { isDuplicateEntry, UniqueConstraintError } from "./errors.ts";

/**
 * AuthRepository：账号、会话、单次消费认证挑战的唯一事实 owner
 * （实施计划 Truth 表）。S2 在此扩展邀请/成员/创建资格。
 */

export interface CreateUserInput {
  emailNormalized: string;
  emailDisplay: string;
  isAdmin: boolean;
}

export interface CreateSessionInput {
  userId: string;
  tokenDigest: string;
  expiresAt: Date;
  now: Date;
}

export interface CreateChallengeInput {
  emailNormalized: string;
  method: "otp" | "magic_link";
  tokenDigest: string;
  expiresAt: Date;
  now: Date;
}

export interface AuthRepository {
  createUser(input: CreateUserInput): Promise<UserRow>;
  findUserByEmailNormalized(emailNormalized: string): Promise<UserRow | null>;
  findUserById(id: string): Promise<UserRow | null>;
  listUsers(input: { limit: number; offset: number }): Promise<UserRow[]>;
  createSession(input: CreateSessionInput): Promise<SessionRow>;
  findSessionByTokenDigest(tokenDigest: string): Promise<SessionRow | null>;
  deleteSession(id: string): Promise<void>;
  /** 滑动续期（GATE-00 §2）：更新 expiresAt 与 lastSeenAt。 */
  extendSession(
    id: string,
    input: { expiresAt: Date; lastSeenAt: Date },
  ): Promise<void>;
  createChallenge(input: CreateChallengeInput): Promise<AuthChallengeRow>;
  findChallengeById(id: string): Promise<AuthChallengeRow | null>;
  /** 按令牌摘要定位 challenge（magic link 与 OTP 校验路径）。 */
  findChallengeByTokenDigest(
    tokenDigest: string,
  ): Promise<AuthChallengeRow | null>;
  /**
   * 原子单次消费（设计 §6.3）：仅当未消费时写入 consumedAt。
   * 返回 true 表示本次调用完成消费；false 表示已被消费。
   */
  consumeChallenge(id: string, now: Date): Promise<boolean>;
  createCreatorGrant(input: {
    userId: string;
    grantedByUserId: string;
  }): Promise<CreatorGrantRow>;
  findActiveCreatorGrant(userId: string): Promise<CreatorGrantRow | null>;
  revokeCreatorGrant(userId: string, now: Date): Promise<boolean>;
  saveDevMail(input: {
    toEmail: string;
    subject: string;
    body: string;
  }): Promise<DevMailInboxRow>;
  listDevMail(toEmail: string): Promise<DevMailInboxRow[]>;
}

export class MysqlAuthRepository implements AuthRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async createUser(input: CreateUserInput): Promise<UserRow> {
    const now = new Date();
    const row: UserRow = {
      id: randomUUID(),
      emailNormalized: input.emailNormalized,
      emailDisplay: input.emailDisplay,
      isAdmin: input.isAdmin,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    try {
      await this.db.insert(users).values(row);
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new UniqueConstraintError("邮箱已存在", { cause: error });
      }
      throw error;
    }
    return row;
  }

  async findUserByEmailNormalized(
    emailNormalized: string,
  ): Promise<UserRow | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, emailNormalized))
      .limit(1);
    return rows[0] ?? null;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createSession(input: CreateSessionInput): Promise<SessionRow> {
    const row: SessionRow = {
      id: randomUUID(),
      tokenDigest: input.tokenDigest,
      userId: input.userId,
      createdAt: input.now,
      expiresAt: input.expiresAt,
      lastSeenAt: input.now,
    };
    await this.db.insert(sessions).values(row);
    return row;
  }

  async findSessionByTokenDigest(
    tokenDigest: string,
  ): Promise<SessionRow | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenDigest, tokenDigest))
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  async extendSession(
    id: string,
    input: { expiresAt: Date; lastSeenAt: Date },
  ): Promise<void> {
    await this.db
      .update(sessions)
      .set({ expiresAt: input.expiresAt, lastSeenAt: input.lastSeenAt })
      .where(eq(sessions.id, id));
  }

  async createChallenge(
    input: CreateChallengeInput,
  ): Promise<AuthChallengeRow> {
    const row: AuthChallengeRow = {
      id: randomUUID(),
      emailNormalized: input.emailNormalized,
      method: input.method,
      tokenDigest: input.tokenDigest,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: input.now,
    };
    await this.db.insert(authChallenges).values(row);
    return row;
  }

  async findChallengeById(id: string): Promise<AuthChallengeRow | null> {
    const rows = await this.db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findChallengeByTokenDigest(
    tokenDigest: string,
  ): Promise<AuthChallengeRow | null> {
    const rows = await this.db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.tokenDigest, tokenDigest))
      .limit(1);
    return rows[0] ?? null;
  }

  async consumeChallenge(id: string, now: Date): Promise<boolean> {
    const [result] = await this.db
      .update(authChallenges)
      .set({ consumedAt: now })
      .where(and(eq(authChallenges.id, id), isNull(authChallenges.consumedAt)));
    return result.affectedRows === 1;
  }

  async createCreatorGrant(input: {
    userId: string;
    grantedByUserId: string;
  }): Promise<CreatorGrantRow> {
    const row: CreatorGrantRow = {
      id: randomUUID(),
      userId: input.userId,
      grantedByUserId: input.grantedByUserId,
      createdAt: new Date(),
      revokedAt: null,
      activeMarker: "active",
      revision: 1,
    };
    try {
      await this.db.insert(creatorGrants).values(row);
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new UniqueConstraintError("该用户已持有有效创建资格", {
          cause: error,
        });
      }
      throw error;
    }
    return row;
  }

  async findActiveCreatorGrant(
    userId: string,
  ): Promise<CreatorGrantRow | null> {
    const rows = await this.db
      .select()
      .from(creatorGrants)
      .where(
        and(eq(creatorGrants.userId, userId), isNull(creatorGrants.revokedAt)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** 条件撤销：仅当仍有效时写入 revokedAt；返回 false 表示已撤销/不存在。 */
  async revokeCreatorGrant(userId: string, now: Date): Promise<boolean> {
    const [result] = await this.db
      .update(creatorGrants)
      .set({ revokedAt: now, activeMarker: null })
      .where(
        and(eq(creatorGrants.userId, userId), isNull(creatorGrants.revokedAt)),
      );
    return result.affectedRows === 1;
  }

  /** 开发收件箱（仅开发模式投递器使用，设计 §6.1/§10）。 */
  async saveDevMail(input: {
    toEmail: string;
    subject: string;
    body: string;
  }): Promise<DevMailInboxRow> {
    const row: DevMailInboxRow = {
      id: randomUUID(),
      toEmail: input.toEmail,
      subject: input.subject,
      body: input.body,
      createdAt: new Date(),
    };
    await this.db.insert(devMailInbox).values(row);
    return row;
  }

  async listDevMail(toEmail: string): Promise<DevMailInboxRow[]> {
    return this.db
      .select()
      .from(devMailInbox)
      .where(eq(devMailInbox.toEmail, toEmail))
      .orderBy(desc(devMailInbox.createdAt));
  }

  async listUsers(input: {
    limit: number;
    offset: number;
  }): Promise<UserRow[]> {
    return this.db
      .select()
      .from(users)
      .orderBy(asc(users.createdAt))
      .limit(input.limit)
      .offset(input.offset);
  }
}
