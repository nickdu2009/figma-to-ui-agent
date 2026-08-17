import { Hono } from "hono";
import type { AuthService } from "../auth/service.ts";
import { normalizeEmail } from "../auth/email.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import { InvitationNotAcceptableError } from "../repositories/app-repository.ts";
import type { MailDelivery } from "../auth/dev-mail.ts";
import type { InvitationRow, MembershipRow } from "../db/schema.ts";
import {
  createAppInputSchema,
  createInvitationInputSchema,
} from "../contracts.ts";
import {
  badRequest,
  conflict,
  errorResponse,
  forbidden,
  notFound,
} from "../middleware/errors.ts";
import {
  createSessionMiddleware,
  requireAdmin,
  requireSession,
} from "../middleware/session.ts";
import { requireMembership as guardMembership } from "../middleware/app-guard.ts";

/**
 * 应用与成员路由（设计 §4.1/§6.2、GATE-00 §4）：
 * - 可信 appId 只来自 URL path；每请求 Session → App → Membership 授权；
 * - 越权/伪造 appId 一律 404（不区分存在与否）；
 * - 邀请接受原子化，重入得到全新 Membership ID；
 * - 拒绝移除最后一个 owner（含 owner 自移除）。
 */

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function invitationStatus(row: InvitationRow, now: Date): string {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt <= now) return "expired";
  return "open";
}

export function createAppMemberRoutes(deps: {
  authService: AuthService;
  appRepository: AppRepository;
  mailDelivery: MailDelivery;
}): Hono {
  const { authService, appRepository, mailDelivery } = deps;
  const routes = new Hono();
  const session = createSessionMiddleware(authService);
  routes.use("*", session);

  /** 当前请求者在该应用的 active membership；不存在即 404（不可见）。 */
  async function requireMembership(appId: string, userId: string) {
    const app = await appRepository.findAppById(appId);
    if (!app || app.status === "deleted") throw notFound();
    // 成员资格检查统一走 S7 共享守卫（conceal：非成员 404）
    const membership = await guardMembership(appRepository, appId, userId, {
      conceal: true,
    });
    return { app, membership };
  }

  async function requireOwnerMembership(appId: string, userId: string) {
    const ctx = await requireMembership(appId, userId);
    if (ctx.membership.role !== "owner") {
      throw forbidden("owner_required", "需要应用所有者权限");
    }
    return ctx;
  }

  // 创建应用：需要 CreatorGrant（管理员授予，设计 §4.1）
  routes.post("/apps", async (c) => {
    try {
      const { user } = requireSession(c);
      const body = createAppInputSchema.safeParse(await c.req.json());
      if (!body.success) throw badRequest("invalid_input", "请求格式不正确");
      const grant = await depsGrantCheck(user.id);
      if (!grant) {
        throw forbidden("creator_grant_required", "需要应用创建资格");
      }
      const { app, ownerMembership } = await appRepository.createAppWithOwner({
        name: body.data.name,
        createdByUserId: user.id,
      });
      return c.json(
        {
          app: {
            id: app.id,
            name: app.name,
            status: app.status,
            myRole: "owner",
            myMembershipId: ownerMembership.id,
            revision: app.revision,
          },
        },
        201,
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  async function depsGrantCheck(userId: string) {
    return authService.findActiveCreatorGrant(userId);
  }

  // 应用列表（多应用选择/刷新恢复，GATE-00 §4）
  routes.get("/apps", async (c) => {
    try {
      const { user } = requireSession(c);
      const rows = await appRepository.listAppsForUser(user.id);
      return c.json({
        apps: rows
          .filter(({ app }) => app.status !== "deleted")
          .map(({ app, membership }) => ({
            id: app.id,
            name: app.name,
            status: app.status,
            myRole: membership.role,
            myMembershipId: membership.id,
            revision: app.revision,
          })),
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 成员列表：任何 active 成员可看
  routes.get("/apps/:appId/members", async (c) => {
    try {
      const { user } = requireSession(c);
      const appId = c.req.param("appId");
      await requireMembership(appId, user.id);
      const members = await appRepository.listMemberships(appId);
      return c.json({
        members: members.map((m: MembershipRow) => ({
          membershipId: m.id,
          userId: m.userId,
          role: m.role,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 邀请列表（owner）
  routes.get("/apps/:appId/invitations", async (c) => {
    try {
      const { user } = requireSession(c);
      const appId = c.req.param("appId");
      await requireOwnerMembership(appId, user.id);
      const now = new Date();
      const rows = await appRepository.listInvitations(appId);
      return c.json({
        invitations: rows.map((r) => ({
          id: r.id,
          email: r.emailNormalized,
          role: r.role,
          status: invitationStatus(r, now),
          expiresAt: r.expiresAt.toISOString(),
        })),
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 创建邀请（owner），通过开发收件箱投递
  routes.post("/apps/:appId/invitations", async (c) => {
    try {
      const { user } = requireSession(c);
      const appId = c.req.param("appId");
      await requireOwnerMembership(appId, user.id);
      const body = createInvitationInputSchema.safeParse(await c.req.json());
      if (!body.success) throw badRequest("invalid_input", "请求格式不正确");
      const emailNormalized = normalizeEmail(body.data.email);
      const now = new Date();
      const invitation = await appRepository.createInvitation({
        appId,
        emailNormalized,
        role: body.data.role,
        createdByUserId: user.id,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      });
      await mailDelivery.send({
        to: emailNormalized,
        subject: "应用邀请",
        body: `您被邀请加入应用（角色：${invitation.role}）。接受邀请：http://127.0.0.1:3100/invitations/${invitation.id}/accept`,
      });
      return c.json(
        {
          invitation: {
            id: invitation.id,
            email: invitation.emailNormalized,
            role: invitation.role,
            status: "open",
            expiresAt: invitation.expiresAt.toISOString(),
          },
        },
        201,
      );
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 撤销邀请（owner）
  routes.delete("/apps/:appId/invitations/:invitationId", async (c) => {
    try {
      const { user } = requireSession(c);
      const appId = c.req.param("appId");
      await requireOwnerMembership(appId, user.id);
      const ok = await appRepository.revokeInvitation(
        c.req.param("invitationId"),
        new Date(),
      );
      if (!ok) throw conflict("invitation_not_revocable", "邀请不可撤销");
      return c.json({ ok: true });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 接受邀请：登录用户邮箱必须与邀请邮箱一致
  routes.post("/invitations/:invitationId/accept", async (c) => {
    try {
      const { user } = requireSession(c);
      const invitationId = c.req.param("invitationId");
      const invitation = await appRepository.findInvitationById(invitationId);
      if (!invitation) throw notFound();
      if (invitation.emailNormalized !== normalizeEmail(user.emailDisplay)) {
        throw forbidden(
          "invitation_email_mismatch",
          "邀请邮箱与当前账号不一致",
        );
      }
      const membership = await appRepository.acceptInvitation({
        invitationId,
        userId: user.id,
        now: new Date(),
      });
      if (!membership) {
        throw conflict("invitation_not_acceptable", "邀请不可接受");
      }
      return c.json({
        membership: {
          membershipId: membership.id,
          appId: membership.appId,
          role: membership.role,
        },
      });
    } catch (error) {
      if (error instanceof InvitationNotAcceptableError) {
        return errorResponse(
          c,
          conflict("invitation_not_acceptable", "邀请不可接受"),
        );
      }
      return errorResponse(c, error);
    }
  });

  // 移除成员（owner）：拒绝移除最后一个 owner（含 owner 自移除）
  routes.delete("/apps/:appId/memberships/:membershipId", async (c) => {
    try {
      const { user } = requireSession(c);
      const appId = c.req.param("appId");
      await requireOwnerMembership(appId, user.id);
      const target = await appRepository.findMembershipById(
        c.req.param("membershipId"),
      );
      if (!target || target.appId !== appId || target.status !== "active") {
        throw notFound();
      }
      if (target.role === "owner") {
        const owners = await appRepository.countActiveOwners(appId);
        if (owners <= 1) {
          throw conflict("last_owner_removal", "不能移除应用的唯一所有者");
        }
      }
      const ok = await appRepository.removeMembership(target.id, new Date());
      if (!ok) throw conflict("member_not_removable", "成员不可移除");
      return c.json({ ok: true });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  // 管理员：授予/撤销 CreatorGrant
  routes.post("/admin/users/:userId/creator-grant", async (c) => {
    try {
      const { user } = requireAdmin(c);
      const grant = await authService.createCreatorGrant({
        userId: c.req.param("userId"),
        grantedByUserId: user.id,
      });
      return c.json({ grant: { userId: grant.userId } }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.delete("/admin/users/:userId/creator-grant", async (c) => {
    try {
      requireAdmin(c);
      const targetUserId = c.req.param("userId");
      // 所有权转移未完成时拒绝禁用持有应用的用户（设计 §4.1）
      const owned = await appRepository.listAppsForUser(targetUserId);
      if (
        owned.some(
          ({ app, membership }) =>
            app.status !== "deleted" && membership.role === "owner",
        )
      ) {
        throw conflict(
          "ownership_transfer_required",
          "该用户仍持有应用所有权，需先完成转移",
        );
      }
      const ok = await authService.revokeCreatorGrant(targetUserId, new Date());
      if (!ok) throw conflict("grant_not_revocable", "资格不可撤销或不存在");
      return c.json({ ok: true });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return routes;
}
