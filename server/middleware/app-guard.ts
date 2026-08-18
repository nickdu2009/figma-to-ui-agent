/**
 * S7：统一的应用级授权守卫（Session → App → Membership → 角色上限）。
 * 此前各路由文件内联复制 requireMembership/requireOwnerMembership；
 * 这里集中为唯一实现，授权语义不变：
 * - 应用不存在或已删除 → 404（已删除应用的全部正常路由关闭，设计 §4.5）
 * - 无有效成员资格 → 403
 * - 角色只能收紧：owner ⊇ editor ⊇ viewer
 */
import { forbidden, notFound } from "./errors.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { MembershipRow } from "../db/schema.ts";

export type AppRole = "owner" | "editor" | "viewer";

const ROLE_RANK: Record<AppRole, number> = { viewer: 0, editor: 1, owner: 2 };

export interface GuardOptions {
 /** conceal=true 时对非成员/角色不足返回 404（发布/生成/回收站路由语义） */
 conceal?: boolean;
}

/** 应用必须存在且未删除；成员资格必须有效。返回调用方成员行。 */
export async function requireMembership(
 appRepository: AppRepository,
 appId: string,
 userId: string,
 opts: GuardOptions = {},
): Promise<MembershipRow> {
 const app = await appRepository.findAppById(appId);
 if (!app || app.status === "deleted") {
  throw notFound("应用不存在");
 }
 const membership = await appRepository.findActiveMembership(appId, userId);
 if (!membership) {
  if (opts.conceal) throw notFound();
  throw forbidden("not_app_member", "不是该应用成员");
 }
 return membership;
}

/** 角色下限守卫：要求调用方角色至少达到 minRole。 */
export async function requireRole(
 appRepository: AppRepository,
 appId: string,
 userId: string,
 minRole: AppRole,
 opts: GuardOptions = {},
): Promise<MembershipRow> {
 const membership = await requireMembership(appRepository, appId, userId, opts);
 if (ROLE_RANK[membership.role as AppRole] < ROLE_RANK[minRole]) {
  if (opts.conceal) throw notFound();
  throw forbidden("role_required", "权限不足");
 }
 return membership;
}

export async function requireOwnerMembership(
 appRepository: AppRepository,
 appId: string,
 userId: string,
 opts: GuardOptions = {},
): Promise<MembershipRow> {
 return requireRole(appRepository, appId, userId, "owner", opts);
}
