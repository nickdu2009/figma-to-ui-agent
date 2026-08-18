import { Hono } from "hono";
import type { AuthService } from "../auth/service.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { BusinessDataRepository } from "../repositories/business-data-repository.ts";
import type { RecycleBinService } from "../recycle-bin/service.ts";
import type { BusinessDataService } from "../business-data/service.ts";
import {
  createSessionMiddleware,
  requireAdmin,
  requireSession,
} from "../middleware/session.ts";
import { notFound } from "../middleware/errors.ts";
import { requireOwnerMembership as guardOwner } from "../middleware/app-guard.ts";
import { findCollection } from "../business-data/schema-contract.ts";

/**
 * 回收站与平台治理路由（S5b，设计 §4.6/§6.3、AC9/AC15）：
 * - owner：记录回收站列表/恢复、应用删除；
 * - administrator：独立治理端点删除/恢复应用、列出回收站、触发有界清理；
 *   治理端点不暴露任何业务记录内容（规则 1）。
 */
export function createRecycleBinRoutes(deps: {
  authService: AuthService;
  appRepository: AppRepository;
  businessDataRepository: BusinessDataRepository;
  recycleBin: RecycleBinService;
  businessData: BusinessDataService;
}): Hono {
  const routes = new Hono();
  routes.use("*", createSessionMiddleware(deps.authService));

  const requireOwnerMembership = (appId: string, userId: string) =>
    guardOwner(deps.appRepository, appId, userId, { conceal: true });

  // ---------- owner：记录回收站 ----------
  routes.get("/apps/:appId/recycle-bin", async (c) => {
    const { user } = requireSession(c);
    await requireOwnerMembership(c.req.param("appId"), user.id);
    const items = await deps.businessDataRepository.listDeletedItems(
      c.req.param("appId"),
      "record",
    );
    return c.json({
      items: items.map((item) => ({
        id: item.id,
        itemType: item.itemType,
        recordId: item.itemRef,
        collectionKey: item.collectionKey,
        deletedAt: item.deletedAt,
        expiresAt: item.expiresAt,
      })),
    });
  });

  routes.post("/apps/:appId/recycle-bin/:itemId/restore", async (c) => {
    const { user } = requireSession(c);
    await requireOwnerMembership(c.req.param("appId"), user.id);
    // 恢复需要当前发布 Schema 的集合定义（重建投影 + 唯一复查）
    const schema = await deps.businessData.resolveSchema(c.req.param("appId"));
    const item = await deps.businessDataRepository.findDeletedItem(
      c.req.param("itemId"),
    );
    if (!item || item.appId !== c.req.param("appId")) throw notFound();
    const collection = findCollection(schema, item.collectionKey ?? "");
    if (!collection) throw notFound();
    await deps.recycleBin.restoreRecord({
      appId: c.req.param("appId"),
      deletedItemId: item.id,
      collection,
    });
    return c.json({ ok: true });
  });

  // ---------- owner：删除应用（进回收站） ----------
  routes.delete("/apps/:appId", async (c) => {
    const { user } = requireSession(c);
    await requireOwnerMembership(c.req.param("appId"), user.id);
    await deps.recycleBin.deleteApp({
      appId: c.req.param("appId"),
      deletedByUserId: user.id,
    });
    return c.json({ ok: true });
  });

  // ---------- administrator：独立治理端点（不读取/导出业务数据） ----------
  routes.get("/platform/recycle-bin", async (c) => {
    requireAdmin(c);
    // 应用级回收站条目（仅元数据，不含业务内容）
    const items =
      await deps.businessDataRepository.listAllDeletedItemsByType("app");
    return c.json({
      items: items.map((item) => ({
        id: item.id,
        appId: item.appId,
        deletedAt: item.deletedAt,
        expiresAt: item.expiresAt,
      })),
    });
  });

  routes.post("/platform/apps/:appId/delete", async (c) => {
    const { user } = requireAdmin(c);
    const app = await deps.appRepository.findAppById(c.req.param("appId"));
    if (!app) throw notFound();
    await deps.recycleBin.deleteApp({
      appId: c.req.param("appId"),
      deletedByUserId: user.id,
    });
    return c.json({ ok: true });
  });

  routes.post("/platform/apps/:appId/restore", async (c) => {
    requireAdmin(c);
    await deps.recycleBin.restoreApp(c.req.param("appId"));
    return c.json({ ok: true });
  });

  routes.post("/platform/recycle-bin/cleanup", async (c) => {
    requireAdmin(c);
    const purged = await deps.recycleBin.cleanupExpired(new Date());
    return c.json({ purged });
  });

  return routes;
}
