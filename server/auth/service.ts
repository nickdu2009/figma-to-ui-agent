import type {
  AuthRepository,
  AuthRepository as AuthRepo,
} from "../repositories/auth-repository.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { UserRow, SessionRow } from "../db/schema.ts";
import { EMAIL_NORMALIZATION_VERSION, normalizeEmail } from "./email.ts";
import {
  generateMagicLinkToken,
  generateOtpCode,
  generateSessionToken,
  sha256Digest,
} from "./tokens.ts";
import type { MailDelivery } from "./dev-mail.ts";

/**
 * 认证服务（设计 §4.1/§6.1、GATE-00 决策补充 §2）：
 * - 邀请制 + ADMIN_EMAILS 首次验证建立身份；无公开注册；
 * - OTP / magic link challenge 只存摘要、原子单次消费；
 * - Session 7 天绝对有效期 + 剩余 <50% 滑动续期；令牌只存 SHA-256 摘要；
 * - start 对未知邮箱返回通用接受结果，不泄漏存在性、不投递凭据。
 */

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export interface AuthConfig {
  /** 规范化后的管理员邮箱列表（首次验证建立 admin 用户）。 */
  adminEmails: ReadonlySet<string>;
  now?: () => Date;
}

export interface SessionInfo {
  user: UserRow;
  session: SessionRow;
}

/** verify 成功结果：原始会话令牌只经此返回给路由层写 Cookie。 */
export interface VerifiedAuth {
  user: UserRow;
  sessionToken: string;
}

export type StartAuthResult = { accepted: true };

export class AuthService {
  private readonly auth: AuthRepo;
  private readonly apps: AppRepository;
  private readonly mail: MailDelivery;
  private readonly config: AuthConfig;

  constructor(
    auth: AuthRepository,
    apps: AppRepository,
    mail: MailDelivery,
    config: AuthConfig,
  ) {
    this.auth = auth;
    this.apps = apps;
    this.mail = mail;
    this.config = config;
  }

  private now(): Date {
    return this.config.now?.() ?? new Date();
  }

  /**
   * POST /auth/start：始终返回通用接受结果。
   * 仅当邮箱具备登录资格（已存在用户、有效邀请或 ADMIN_EMAILS）时才
   * 签发 challenge 并投递；未知邮箱不签发、不投递、不报错。
   */
  async startAuth(input: {
    email: string;
    method: "otp" | "magic_link";
  }): Promise<StartAuthResult> {
    const emailNormalized = normalizeEmail(input.email);
    const eligible = await this.isEligible(emailNormalized);
    if (!eligible) return { accepted: true };

    const now = this.now();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    if (input.method === "otp") {
      const code = generateOtpCode();
      await this.auth.createChallenge({
        emailNormalized,
        method: "otp",
        tokenDigest: sha256Digest(code),
        expiresAt,
        now,
      });
      await this.mail.send({
        to: emailNormalized,
        subject: "登录验证码",
        body: `您的登录验证码：${code}（10 分钟内有效）`,
      });
    } else {
      const token = generateMagicLinkToken();
      await this.auth.createChallenge({
        emailNormalized,
        method: "magic_link",
        tokenDigest: sha256Digest(token),
        expiresAt,
        now,
      });
      await this.mail.send({
        to: emailNormalized,
        subject: "登录链接",
        body: `您的登录链接：http://127.0.0.1:3100/login/verify?token=${token}（10 分钟内有效）`,
      });
    }
    return { accepted: true };
  }

  private async isEligible(emailNormalized: string): Promise<boolean> {
    if (this.config.adminEmails.has(emailNormalized)) return true;
    const existing = await this.auth.findUserByEmailNormalized(emailNormalized);
    if (existing) return true;
    return this.apps.hasOpenInvitationForEmail(emailNormalized);
  }

  /** OTP 校验：按摘要精确定位 challenge（不使用“最新”排序，
   *  避免同毫秒 createdAt 并列导致的不确定性）；过期、不匹配、
   *  已消费一律失败关闭（同一通用错误）。 */
  async verifyOtp(input: {
    email: string;
    code: string;
  }): Promise<VerifiedAuth | null> {
    const emailNormalized = normalizeEmail(input.email);
    const challenge = await this.auth.findChallengeByTokenDigest(
      sha256Digest(input.code),
    );
    if (!challenge) return null;
    if (challenge.method !== "otp") return null;
    if (challenge.emailNormalized !== emailNormalized) return null;
    const now = this.now();
    if (challenge.expiresAt <= now) return null;
    const consumed = await this.auth.consumeChallenge(challenge.id, now);
    if (!consumed) return null;
    return this.issueSession(emailNormalized, now);
  }

  /** magic link 校验：按令牌摘要定位 challenge，其余语义同 OTP。 */
  async verifyMagicLink(input: {
    token: string;
  }): Promise<VerifiedAuth | null> {
    const challenge = await this.auth.findChallengeByTokenDigest(
      sha256Digest(input.token),
    );
    if (!challenge) return null;
    const now = this.now();
    if (challenge.expiresAt <= now) return null;
    const consumed = await this.auth.consumeChallenge(challenge.id, now);
    if (!consumed) return null;
    return this.issueSession(challenge.emailNormalized, now);
  }

  /**
   * 建立（或读回）用户并签发 Session。
   * 首次完成验证时：ADMIN_EMAILS 命中即取得管理员角色（设计 §4.1）。
   */
  private async issueSession(
    emailNormalized: string,
    now: Date,
  ): Promise<VerifiedAuth> {
    let user = await this.auth.findUserByEmailNormalized(emailNormalized);
    if (!user) {
      user = await this.auth.createUser({
        emailNormalized,
        emailDisplay: emailNormalized,
        isAdmin: this.config.adminEmails.has(emailNormalized),
      });
    }
    const token = generateSessionToken();
    await this.auth.createSession({
      userId: user.id,
      tokenDigest: sha256Digest(token),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      now,
    });
    // 原始令牌只通过返回值交给路由层写 Cookie；不落库、不落日志。
    return { user, sessionToken: token };
  }

  /** 解析会话令牌（Cookie 值 = 原始令牌）；含过期校验与滑动续期。 */
  async resolveSession(token: string): Promise<SessionInfo | null> {
    const session = await this.auth.findSessionByTokenDigest(
      sha256Digest(token),
    );
    if (!session) return null;
    const now = this.now();
    if (session.expiresAt <= now) {
      await this.auth.deleteSession(session.id);
      return null;
    }
    // 滑动续期：剩余 <50% 时延长绝对有效期（GATE-00 §2）
    if (session.expiresAt.getTime() - now.getTime() < SESSION_TTL_MS / 2) {
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
      await this.auth.extendSession(session.id, {
        expiresAt,
        lastSeenAt: now,
      });
      session.expiresAt = expiresAt;
      session.lastSeenAt = now;
    }
    const user = await this.auth.findUserById(session.userId);
    if (!user) return null;
    return { user, session };
  }

  /** 登出：服务端删除 Session 行（立即失效，GATE-00 §2）。 */
  async logout(token: string): Promise<void> {
    const session = await this.auth.findSessionByTokenDigest(
      sha256Digest(token),
    );
    if (session) await this.auth.deleteSession(session.id);
  }

  // ---------- CreatorGrant（创建资格，设计 §4.1） ----------

  async findActiveCreatorGrant(userId: string) {
    return this.auth.findActiveCreatorGrant(userId);
  }

  async createCreatorGrant(input: { userId: string; grantedByUserId: string }) {
    return this.auth.createCreatorGrant(input);
  }

  async revokeCreatorGrant(userId: string, now: Date): Promise<boolean> {
    return this.auth.revokeCreatorGrant(userId, now);
  }
}

export { EMAIL_NORMALIZATION_VERSION, normalizeEmail };
