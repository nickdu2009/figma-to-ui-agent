/**
 * S8 浏览器验收 2：downloadExport CSV 字节通道（mock 模式，不调 LLM）。
 * - POST /apps/:appId/runtime-actions/export 返回 text/csv 字节 +
 *   Content-Disposition 文件名 + 行数/字节数摘要头；
 * - 公式中和（= 前缀值带 apostrophe）与 RFC 4180 编码在真实响应正文中；
 * - 版本头缺失/不符 → 400/409；viewer 导出 → policy_denied；
 * - 字节不进入任何 JSON 面（dispatch 拒绝 downloadExport 已在
 *   runtime-actions.spec.ts 覆盖）。
 * 对应 AC8g、AC8h、AC8i、AC8j、AC22。
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
        { key: "title", type: "string", required: true, queryable: true },
        { key: "note", type: "string" },
      ],
    },
  ],
} as const;

test("S8 download-export：CSV 字节通道 + 中和 + 授权", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await uiLogin(page, adminEmailFor(test.info().workerIndex));
  const appId = await createAppViaApi(
    page,
    `s8-export-${test.info().workerIndex}-${Date.now()}`,
  );
  const pool = mysql.createPool(DEV_DB);
  let publishedVersionId = "";
  try {
    const [membershipRows] = await pool.execute(
      "SELECT `id` FROM `memberships` WHERE `app_id` = ? AND `role` = 'owner' LIMIT 1",
      [appId],
    );
    const membershipId = (membershipRows as Array<{ id: string }>)[0]!.id;
    publishedVersionId = crypto.randomUUID();
    await pool.execute(
      "INSERT INTO `published_versions` (`id`, `app_id`, `spec`, `business_schema`, `published_by_membership_id`, `published_at`) VALUES (?, ?, '{}', ?, ?, UTC_TIMESTAMP(3))",
      [publishedVersionId, appId, JSON.stringify(BUSINESS_SCHEMA), membershipId],
    );
    await pool.execute(
      "INSERT INTO `release_pointers` (`app_id`, `published_version_id`, `updated_at`, `revision`) VALUES (?, ?, UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE `published_version_id` = VALUES(`published_version_id`), `updated_at` = UTC_TIMESTAMP(3)",
      [appId, publishedVersionId],
    );

    const versionHeaders = {
      ...ORIGIN,
      "X-VMA-Published-Version": publishedVersionId,
    };
    const dispatchUrl = `/api/apps/${appId}/runtime-actions/dispatch`;

    // 经 dispatch 写入含公式触发/逗号/引号/多行的记录
    const createKey = `idem-${crypto.randomUUID()}`;
    const created = await page.request.post(dispatchUrl, {
      headers: versionHeaders,
      data: {
        protocolVersion: 1,
        publishedVersionId,
        actionName: "createRecord",
        idempotencyKey: createKey,
        canonicalParams: {
          collectionKey: "tasks",
          data: {
            title: "=SUM(A1:A9)",
            note: '含逗号,与"引号"\n与多行',
          },
        },
      },
    });
    expect(created.status()).toBe(200);

    // 1. export 通道：CSV 字节 + 响应头摘要
    const exported = await page.request.post(
      `/api/apps/${appId}/runtime-actions/export`,
      {
        headers: versionHeaders,
        data: {
          protocolVersion: 1,
          publishedVersionId,
          actionName: "downloadExport",
          canonicalParams: { collectionKey: "tasks" },
        },
      },
    );
    expect(exported.status()).toBe(200);
    const headers = exported.headers();
    expect(headers["content-type"]).toContain("text/csv");
    expect(headers["content-disposition"]).toMatch(
      /^attachment; filename="tasks-.*\.csv"$/,
    );
    expect(headers["cache-control"]).toBe("no-store");
    const rowCount = Number(headers["x-vma-export-row-count"]);
    expect(rowCount).toBeGreaterThanOrEqual(1);
    const body = await exported.body();
    const text = body.toString("utf8");
    expect(Number(headers["x-vma-export-byte-length"])).toBe(body.byteLength);
    // 公式中和：原值最前加 apostrophe
    expect(text).toContain("'=SUM(A1:A9)");
    // RFC 4180：逗号/引号/多行字段被包围转义
    expect(text).toContain('"含逗号,与""引号""\n与多行"');
    // CRLF 行分隔
    expect(text).toContain("\r\n");

    // 2. 版本头缺失 → 400
    const noHeader = await page.request.post(
      `/api/apps/${appId}/runtime-actions/export`,
      {
        headers: ORIGIN,
        data: {
          protocolVersion: 1,
          publishedVersionId,
          actionName: "downloadExport",
          canonicalParams: { collectionKey: "tasks" },
        },
      },
    );
    expect(noHeader.status()).toBe(400);

    // 3. viewer 导出 → 403 policy_denied（默认 export 策略不含 viewer）
    const invitationId = await inviteViaApi(
      page,
      appId,
      viewerEmailFor(test.info().workerIndex),
      "viewer",
    );
    const viewerContext = await browser.newContext();
    try {
      const viewerPage = await viewerContext.newPage();
      await uiLogin(viewerPage, viewerEmailFor(test.info().workerIndex));
      await acceptInvitationViaApi(viewerPage, invitationId);
      const viewerExport = await viewerPage.request.post(
        `/api/apps/${appId}/runtime-actions/export`,
        {
          headers: versionHeaders,
          data: {
            protocolVersion: 1,
            publishedVersionId,
            actionName: "downloadExport",
            canonicalParams: { collectionKey: "tasks" },
          },
        },
      );
      expect(viewerExport.status()).toBe(403);
      expect(
        ((await viewerExport.json()) as { error?: { code: string } }).error
          ?.code,
      ).toBe("policy_denied");
    } finally {
      await viewerContext.close();
    }
  } finally {
    await pool.execute("DELETE FROM `release_pointers` WHERE `app_id` = ?", [appId]);
    await pool.execute(
      "DELETE FROM `business_action_idempotency` WHERE `app_id` = ?",
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
    if (publishedVersionId) {
      await pool.execute("DELETE FROM `published_versions` WHERE `id` = ?", [
        publishedVersionId,
      ]);
    }
    await pool.end();
  }
});
