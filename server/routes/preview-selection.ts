/**
 * PreviewSelection 与 Preview Commit 路由（设计 §13.2.3，计划 S11 动作 6/8）。
 *
 * 核心语义：
 * 1. GET /apps/:appId/preview-selection：读取调用方当前成员的预览选择（Draft 视图或 Published 跟随）；
 * 2. PUT /apps/:appId/preview-selection：切换预览选择（published 只存哨兵不绑定历史版本）；
 * 3. POST /apps/:appId/preview-commit：接收浏览器 PreviewResult，在同一事务中
 *    校验 run/digests/report，幂等创建 DraftVersion、完成 run 并更新 PreviewSelection。
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AuthService } from "../auth/service.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { ReleaseRepository } from "../repositories/release-repository.ts";
import type { PreviewSelectionRepository } from "../repositories/preview-selection-repository.ts";
import {
  createSessionMiddleware,
  requireSession,
} from "../middleware/session.ts";
import { requireMembership } from "../middleware/app-guard.ts";
import {
  assertMutationAllowed,
  assertMutationProtocolVersion,
  ProtocolFenceError,
  type ProtocolMode,
} from "../persistence/protocol-mode.ts";

const updateSelectionSchema = z.object({
  selectionKind: z.enum(["draft", "published"]),
  selectedVersionId: z.string().nullable().optional(),
});

const previewCommitBodySchema = z.object({
  generationId: z.string().min(1),
  candidateDigest: z.string().min(1),
  uiBundleDigest: z.string().min(1),
  reportDigest: z.string().min(1),
  /** v2 写入必须显式携带；compat 期间保留缺省 v1 以完成历史回填。 */
  protocolVersion: z.number().int().optional(),
}).strict();

export function createPreviewSelectionRoutes(deps: {
  authService: AuthService;
  appRepository: AppRepository;
  releaseRepository: ReleaseRepository;
  previewSelectionRepository: PreviewSelectionRepository;
  protocolMode?: ProtocolMode;
}): Hono {
  const routes = new Hono();
  routes.use("*", createSessionMiddleware(deps.authService));

  // GET /apps/:appId/preview-selection
  routes.get("/apps/:appId/preview-selection", async (c) => {
    const { user } = requireSession(c);
    const appId = c.req.param("appId");
    const membership = await requireMembership(
      deps.appRepository,
      appId,
      user.id,
      {
        conceal: true,
      },
    );

    const selection = await deps.previewSelectionRepository.findSelection(
      appId,
      membership.id,
    );

    if (selection && selection.kind === "draft" && selection.versionId) {
      const draft = await deps.releaseRepository.findDraftById(
        selection.versionId,
      );
      if (draft && draft.appId === appId) {
        return c.json({
          selectionKind: "draft",
          selectedVersionId: draft.id,
          version: {
            id: draft.id,
            bundle: draft.bundle ?? null,
            spec: draft.spec,
            candidateDigest: draft.candidateDigest ?? null,
            uiBundleDigest: draft.uiBundleDigest ?? null,
            publishBlocked: Boolean(draft.publishBlocked),
            validationIssues: draft.validationIssues ?? null,
            createdAt: draft.createdAt,
          },
        });
      }
    }

    // 默认或 published：解析 ReleasePointer
    const pointer = await deps.releaseRepository.getReleasePointer(appId);
    let publishedVersion = null;
    if (pointer) {
      const published = await deps.releaseRepository.findPublishedVersionById(
        pointer.publishedVersionId,
      );
      if (published) {
        publishedVersion = {
          id: published.id,
          bundle: published.bundle ?? null,
          spec: published.spec,
          candidateDigest: published.candidateDigest ?? null,
          uiBundleDigest: published.uiBundleDigest ?? null,
          publishedAt: published.publishedAt,
        };
      }
    }

    return c.json({
      selectionKind: "published",
      selectedVersionId: null,
      version: publishedVersion,
    });
  });

  // PUT /apps/:appId/preview-selection
  routes.put("/apps/:appId/preview-selection", async (c) => {
    const { user } = requireSession(c);
    const appId = c.req.param("appId");
    const membership = await requireMembership(
      deps.appRepository,
      appId,
      user.id,
      {
        conceal: true,
      },
    );
    try {
      assertMutationAllowed(deps.protocolMode ?? "compat", "draft_mutation");
    } catch (err) {
      if (err instanceof ProtocolFenceError) {
        return c.json(
          { error: { code: err.code, message: err.message } },
          err.status as 423,
        );
      }
      throw err;
    }

    const parsed = updateSelectionSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: { code: "invalid_params", message: "参数不合法" } },
        400,
      );
    }

    const { selectionKind, selectedVersionId } = parsed.data;
    if (selectionKind === "draft") {
      if (!selectedVersionId) {
        return c.json(
          { error: { code: "draft_id_required", message: "缺少草稿 ID" } },
          400,
        );
      }
      const draft =
        await deps.releaseRepository.findDraftById(selectedVersionId);
      if (!draft || draft.appId !== appId) {
        return c.json(
          { error: { code: "draft_not_found", message: "草稿不存在" } },
          404,
        );
      }
      await deps.previewSelectionRepository.upsertSelection({
        appId,
        membershipId: membership.id,
        kind: "draft",
        versionId: draft.id,
        revision: 1,
      });
    } else {
      // published：只保存哨兵
      await deps.previewSelectionRepository.upsertSelection({
        appId,
        membershipId: membership.id,
        kind: "published",
      });
    }

    return c.json({ ok: true, selectionKind });
  });

  // POST /apps/:appId/preview-commit
  routes.post("/apps/:appId/preview-commit", async (c) => {
    const { user } = requireSession(c);
    const appId = c.req.param("appId");
    const membership = await requireMembership(
      deps.appRepository,
      appId,
      user.id,
      {
        conceal: true,
      },
    );
    try {
      assertMutationAllowed(deps.protocolMode ?? "compat", "preview_commit");
    } catch (err) {
      if (err instanceof ProtocolFenceError) {
        return c.json(
          { error: { code: err.code, message: err.message } },
          err.status as 423,
        );
      }
      throw err;
    }

    const parsed = previewCommitBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        {
          error: { code: "invalid_params", message: "PreviewResult 结构无效" },
        },
        400,
      );
    }

    const body = parsed.data;
    try {
      assertMutationProtocolVersion(
        deps.protocolMode ?? "compat",
        "preview_commit",
        body.protocolVersion,
      );
    } catch (err) {
      if (err instanceof ProtocolFenceError) {
        return c.json(
          { error: { code: err.code, message: err.message } },
          err.status as 400,
        );
      }
      throw err;
    }
    const run =
      (await deps.releaseRepository.findRunByCorrelationRef(
        body.generationId,
      )) ?? (await deps.releaseRepository.findRunById(body.generationId));

    if (!run || run.appId !== appId) {
      return c.json(
        {
          error: {
            code: "generation_run_not_found",
            message: "GenerationRun 不存在或不属于该应用",
          },
        },
        404,
      );
    }

    const commitOutcome = await deps.releaseRepository.commitPreview({
      runId: run.id,
      candidateDigest: body.candidateDigest,
      uiBundleDigest: body.uiBundleDigest,
      reportDigest: body.reportDigest,
      membershipId: membership.id,
      now: new Date(),
    });

    if (!commitOutcome.ok) {
      return c.json(
        {
          error: {
            code: commitOutcome.code,
            message: commitOutcome.message,
          },
        },
        409,
      );
    }

    return c.json({
      ok: true,
      draftVersionId: commitOutcome.draftVersionId,
      candidateDigest: commitOutcome.candidateDigest,
      uiBundleDigest: commitOutcome.uiBundleDigest,
    });
  });

  return routes;
}
