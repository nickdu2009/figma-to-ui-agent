/**
 * S8 浏览器验收 1：runtime-actions dispatch 路由与 DraftDataView（mock 模式，
 * 不调 LLM）。经真实浏览器会话（cookie 凭证）+ page.request 全链路：
 * - 唯一入口 POST /apps/:appId/runtime-actions/dispatch：只信 path appId +
 *   Session；body 拒绝身份/角色/替代 appId（strict 信封）；
 * - X-VMA-Published-Version 头缺失/与 body 不一致 → 400；与 current
 *   pointer 不符 → 409 published_version_changed；
 * - 写命令幂等：同 key/hash 重放同结果、错 hash → idempotency_key_conflict；
 * - viewer 写 → policy_denied；未登录 → 401；
 * - downloadExport 不得经 dispatch（400），export 通道只收 downloadExport；
 * - DraftDataView：查询交集投影 + 写入/导出稳定 409 draft_readonly。
 * 对应 AC6、AC7、AC8、AC8c、AC8f、AC21。
 */
import { expect, test } from "@playwright/test";
import mysql from "mysql2/promise";
import {
  adminEmailFor,
  viewerEmailFor,
  createAppViaApi,
  uiLogin,
  inviteViaApi,
  acceptInvitationViaApi,
} from "./e2e-helpers.ts";

const ORIGIN = { Origin: "http://127.0.0.1:3100" };
const DEV_DB =
  process.env.VMA_DATABASE_URL ??
  "mysql://vma:vma-local-dev-only@127.0.0.1:3317/vite_multipage_agent";

const BUSINESS_SCHEMA = {
  collections: [
    {
      key: "tasks",
      recordScope: "shared",
      fields: [
        { key: "title", type: "string", required: true, queryable: true, sortable: true },
        { key: "done", type: "boolean", queryable: true },
      ],
    },
  ],
} as const;

interface SeedResult {
  publishedVersionId: string;
  draftId: string;
}

async function seedPublishedAndDraft(
  pool: mysql.Pool,
  appId: string,
): Promise<SeedResult> {
  const [membershipRows] = await pool.execute(
    "SELECT `id` FROM `memberships` WHERE `app_id` = ? AND `role` = 'owner' LIMIT 1",
    [appId],
  );
  const membershipId = (membershipRows as Array<{ id: string }>)[0]!.id;
  const publishedVersionId = crypto.randomUUID();
  const draftId = crypto.randomUUID();
  const generationRunId = crypto.randomUUID();
  await pool.execute(
    "INSERT INTO `published_versions` (`id`, `app_id`, `spec`, `business_schema`, `published_by_membership_id`, `published_at`) VALUES (?, ?, '{}', ?, ?, UTC_TIMESTAMP(3))",
    [publishedVersionId, appId, JSON.stringify(BUSINESS_SCHEMA), membershipId],
  );
  await pool.execute(
    "INSERT INTO `release_pointers` (`app_id`, `published_version_id`, `updated_at`, `revision`) VALUES (?, ?, UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE `published_version_id` = VALUES(`published_version_id`), `updated_at` = UTC_TIMESTAMP(3)",
    [appId, publishedVersionId],
  );
  await pool.execute(
    "INSERT INTO `generation_runs` (`id`, `app_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, 'succeeded', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
    [generationRunId, appId],
  );
  await pool.execute(
    "INSERT INTO `draft_versions` (`id`, `app_id`, `generation_run_id`, `spec`, `business_schema`, `status`, `created_at`) VALUES (?, ?, ?, '{}', ?, 'ready', UTC_TIMESTAMP(3))",
    [draftId, appId, generationRunId, JSON.stringify(BUSINESS_SCHEMA)],
  );
  return { publishedVersionId, draftId };
}

async function cleanupSeeds(
  pool: mysql.Pool,
  appId: string,
  seeds: SeedResult,
): Promise<void> {
  await pool.execute("DELETE FROM `release_pointers` WHERE `app_id` = ?", [appId]);
  await pool.execute(
    "DELETE FROM `business_action_idempotency` WHERE `app_id` = ?",
    [appId],
  );
  await pool.execute("DELETE FROM `deleted_items` WHERE `app_id` = ?", [appId]);
  await pool.execute(
    "DELETE FROM `record_principals` WHERE `app_id` = ?",
    [appId],
  );
  await pool.execute(
    "DELETE FROM `business_unique_values` WHERE `app_id` = ?",
    [appId],
  );
  await pool.execute(
    "DELETE FROM `business_index_values` WHERE `app_id` = ?",
    [appId],
  );
  await pool.execute("DELETE FROM `business_records` WHERE `app_id` = ?", [appId]);
  await pool.execute("DELETE FROM `draft_versions` WHERE `id` = ?", [seeds.draftId]);
  await pool.execute("DELETE FROM `published_versions` WHERE `id` = ?", [
    seeds.publishedVersionId,
  ]);
  await pool.execute(
    "DELETE FROM `generation_runs` WHERE `app_id` = ? AND `status` = 'succeeded'",
    [appId],
  );
}

function envelope(
  publishedVersionId: string,
  actionName: string,
  canonicalParams: unknown,
  idempotencyKey?: string,
): Record<string, unknown> {
  return {
    protocolVersion: 1,
    publishedVersionId,
    actionName,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    canonicalParams,
  };
}

test("S8 runtime-actions：dispatch 全链路 + 故障注入 + DraftDataView", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await uiLogin(page, adminEmailFor(test.info().workerIndex));
  const appId = await createAppViaApi(
    page,
    `s8-actions-${test.info().workerIndex}-${Date.now()}`,
  );
  const pool = mysql.createPool(DEV_DB);
  let seeds: SeedResult | null = null;
  try {
    seeds = await seedPublishedAndDraft(pool, appId);
    const dispatchUrl = `/api/apps/${appId}/runtime-actions/dispatch`;
    const versionHeaders = {
      ...ORIGIN,
      "X-VMA-Published-Version": seeds.publishedVersionId,
    };

    // 1. createRecord 成功（写命令携带幂等键）
    const createKey = `idem-${crypto.randomUUID()}`;
    const created = await page.request.post(dispatchUrl, {
      headers: versionHeaders,
      data: envelope(
        seeds.publishedVersionId,
        "createRecord",
        { collectionKey: "tasks", data: { title: "浏览器全链路", done: false } },
        createKey,
      ),
    });
    expect(created.status()).toBe(200);
    const createdBody = (await created.json()) as {
      status: string;
      serverRequestId: string;
      data: { recordId: string; revision: number; data: { title: string } };
    };
    expect(createdBody.status).toBe("success");
    expect(createdBody.serverRequestId).toBeTruthy();
    expect(createdBody.data.data.title).toBe("浏览器全链路");

    // 2. 同 key/hash 重放：同一 recordId（无第二 mutation）
    const replay = await page.request.post(dispatchUrl, {
      headers: versionHeaders,
      data: envelope(
        seeds.publishedVersionId,
        "createRecord",
        { collectionKey: "tasks", data: { title: "浏览器全链路", done: false } },
        createKey,
      ),
    });
    const replayBody = (await replay.json()) as {
      status: string;
      data: { recordId: string };
    };
    expect(replayBody.status).toBe("success");
    expect(replayBody.data.recordId).toBe(createdBody.data.recordId);

    // 3. 同 key 错 hash → 409 idempotency_key_conflict
    const conflict = await page.request.post(dispatchUrl, {
      headers: versionHeaders,
      data: envelope(
        seeds.publishedVersionId,
        "createRecord",
        { collectionKey: "tasks", data: { title: "不同内容", done: true } },
        createKey,
      ),
    });
    expect(conflict.status()).toBe(409);
    expect(((await conflict.json()) as { error?: { code: string } }).error?.code).toBe(
      "idempotency_key_conflict",
    );

    // 4. 缺版本头 → 400；头/body 不一致 → 400
    const noHeader = await page.request.post(dispatchUrl, {
      headers: ORIGIN,
      data: envelope(seeds.publishedVersionId, "queryRecords", {
        collectionKey: "tasks",
      }),
    });
    expect(noHeader.status()).toBe(400);
    const mismatchHeader = await page.request.post(dispatchUrl, {
      headers: { ...ORIGIN, "X-VMA-Published-Version": crypto.randomUUID() },
      data: envelope(seeds.publishedVersionId, "queryRecords", {
        collectionKey: "tasks",
      }),
    });
    expect(mismatchHeader.status()).toBe(400);

    // 5. 版本与 current pointer 不符 → 409 published_version_changed
    const stale = await page.request.post(dispatchUrl, {
      headers: versionHeaders,
      data: envelope(crypto.randomUUID(), "queryRecords", {
        collectionKey: "tasks",
      }),
    });
    // 头与 body 一致但版本过期：头必须等于 body 的 publishedVersionId
    const staleId = crypto.randomUUID();
    const staleSync = await page.request.post(dispatchUrl, {
      headers: { ...ORIGIN, "X-VMA-Published-Version": staleId },
      data: envelope(staleId, "queryRecords", { collectionKey: "tasks" }),
    });
    expect(stale.status()).toBe(400); // 头/body 不一致优先
    expect(staleSync.status()).toBe(409);
    expect(
      ((await staleSync.json()) as { error?: { code: string } }).error?.code,
    ).toBe("published_version_changed");

    // 6. body 携带身份/角色/替代 appId → strict 信封 400
    const withIdentity = await page.request.post(dispatchUrl, {
      headers: versionHeaders,
      data: {
        ...envelope(seeds.publishedVersionId, "queryRecords", {
          collectionKey: "tasks",
        }),
        role: "owner",
      },
    });
    expect(withIdentity.status()).toBe(400);

    // 7. queryRecords 读 + updateRecord 修订冲突
    const queried = await page.request.post(dispatchUrl, {
      headers: versionHeaders,
      data: envelope(seeds.publishedVersionId, "queryRecords", {
        collectionKey: "tasks",
        where: { done: false },
      }),
    });
    expect(queried.status()).toBe(200);
    const queryBody = (await queried.json()) as {
      data: { items: Array<{ recordId: string; revision: number }> };
    };
    expect(queryBody.data.items.length).toBeGreaterThanOrEqual(1);
    const revisionConflict = await page.request.post(dispatchUrl, {
      headers: versionHeaders,
      data: envelope(
        seeds.publishedVersionId,
        "updateRecord",
        {
          collectionKey: "tasks",
          recordId: createdBody.data.recordId,
          expectedRevision: 99,
          patch: { done: true },
        },
        `idem-${crypto.randomUUID()}`,
      ),
    });
    expect(revisionConflict.status()).toBe(409);
    expect(
      ((await revisionConflict.json()) as { error?: { code: string } }).error
        ?.code,
    ).toBe("revision_conflict");

    // 8. downloadExport 不得经 dispatch；export 通道只收 downloadExport
    const exportViaDispatch = await page.request.post(dispatchUrl, {
      headers: versionHeaders,
      data: envelope(seeds.publishedVersionId, "downloadExport", {
        collectionKey: "tasks",
      }),
    });
    expect(exportViaDispatch.status()).toBe(400);
    const wrongViaExport = await page.request.post(
      `/api/apps/${appId}/runtime-actions/export`,
      {
        headers: versionHeaders,
        data: envelope(seeds.publishedVersionId, "queryRecords", {
          collectionKey: "tasks",
        }),
      },
    );
    expect(wrongViaExport.status()).toBe(400);

    // 9. viewer：读成功、写 policy_denied（独立浏览器上下文）
    const invitationId = await inviteViaApi(
      page,
      appId,
      viewerEmailFor(test.info().workerIndex),
      "viewer",
    );
    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    try {
      await uiLogin(viewerPage, viewerEmailFor(test.info().workerIndex));
      await acceptInvitationViaApi(viewerPage, invitationId);
      const viewerRead = await viewerPage.request.post(dispatchUrl, {
        headers: versionHeaders,
        data: envelope(seeds.publishedVersionId, "queryRecords", {
          collectionKey: "tasks",
        }),
      });
      expect(viewerRead.status()).toBe(200);
      const viewerWrite = await viewerPage.request.post(dispatchUrl, {
        headers: versionHeaders,
        data: envelope(
          seeds.publishedVersionId,
          "createRecord",
          { collectionKey: "tasks", data: { title: "越权", done: false } },
          `idem-${crypto.randomUUID()}`,
        ),
      });
      expect(viewerWrite.status()).toBe(403);
      expect(
        ((await viewerWrite.json()) as { error?: { code: string } }).error
          ?.code,
      ).toBe("policy_denied");
    } finally {
      await viewerContext.close();
    }

    // 10. 未登录 → 401
    const anonContext = await browser.newContext();
    try {
      const anon = await anonContext.newPage();
      const unauthenticated = await anon.request.post(dispatchUrl, {
        headers: versionHeaders,
        data: envelope(seeds.publishedVersionId, "queryRecords", {
          collectionKey: "tasks",
        }),
      });
      expect(unauthenticated.status()).toBe(401);
    } finally {
      await anonContext.close();
    }

    // 11. DraftDataView：查询交集投影 + 写入/导出稳定 draft_readonly
    const draftQuery = await page.request.post(
      `/api/apps/${appId}/drafts/${seeds.draftId}/data-view/tasks/query`,
      { headers: ORIGIN, data: { orderBy: { field: "title", direction: "asc" } } },
    );
    expect(draftQuery.status()).toBe(200);
    const draftBody = (await draftQuery.json()) as {
      items: Array<{ data: { title: string } }>;
    };
    expect(
      draftBody.items.some((item) => item.data.title === "浏览器全链路"),
    ).toBe(true);
    const draftWrite = await page.request.post(
      `/api/apps/${appId}/drafts/${seeds.draftId}/data-view/tasks/records`,
      { headers: ORIGIN, data: { title: "草稿写入" } },
    );
    expect(draftWrite.status()).toBe(409);
    expect(
      ((await draftWrite.json()) as { error?: { code: string } }).error?.code,
    ).toBe("draft_readonly");
    const draftExport = await page.request.post(
      `/api/apps/${appId}/drafts/${seeds.draftId}/data-view/tasks/export`,
      { headers: ORIGIN, data: {} },
    );
    expect(draftExport.status()).toBe(409);
    expect(
      ((await draftExport.json()) as { error?: { code: string } }).error?.code,
    ).toBe("draft_readonly");
  } finally {
    if (seeds) await cleanupSeeds(pool, appId, seeds);
    await pool.end();
  }
});
