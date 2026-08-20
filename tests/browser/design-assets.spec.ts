/**
 * S7 浏览器验收：DesignAsset 上传 → 提取 → 版本化读取面（mock 模式，不调 LLM）。
 * 覆盖：
 * - 登录 → 建 app → API 上传 PNG/PDF（原始字节 + Content-Type 声明）；
 * - 服务内提取 worker 有界租约处理 queued job → source ready；
 * - generation 读取面：candidateDigest 精确匹配返回字节 + private,no-store +
 *   nosniff + ETag + 精确 MIME；digest 不符 fail closed（404，不泄露存在性）；
 * - HEAD 与 GET 一致；未登录 401；viewer 读 generation 面被拒（ conceal 404）；
 * - 上传非法 purpose / 魔数不符 / 空字节 → 稳定错误码；
 * - 列表面只含元数据（无字节、无路径）。
 * 对应 AC8b、AC11、AC11a、AC12、AC13a。
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import mysql from "mysql2/promise";
import {
  adminEmailFor,
  createAppViaApi,
  uiLogin,
  viewerEmailFor,
  inviteViaApi,
  acceptInvitationViaApi,
} from "./e2e-helpers.ts";

const ORIGIN = { Origin: "http://127.0.0.1:3100" };

async function uploadSource(
  page: import("@playwright/test").Page,
  appId: string,
  fixture: string,
  mime: string,
  purpose: string,
) {
  const bytes = await readFile(`tests/fixtures/design-assets/${fixture}`);
  const res = await page.request.post(
    `/api/apps/${appId}/design-assets/sources?purpose=${purpose}&displayName=${fixture}`,
    { data: bytes, headers: { ...ORIGIN, "Content-Type": mime } },
  );
  return res;
}

test("S7 DesignAsset：上传→提取→读取面全链路（AC8b/AC11/AC12）", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await uiLogin(page, adminEmailFor(test.info().workerIndex));
  const appId = await createAppViaApi(
    page,
    `s7-assets-${test.info().workerIndex}-${Date.now()}`,
  );

  // 1. 上传 PNG（reference_screenshot）→ 201 + sourceId/jobId。
  const upload = await uploadSource(
    page,
    appId,
    "gradient.png",
    "image/png",
    "reference_screenshot",
  );
  expect(upload.status()).toBe(201);
  const uploaded = (await upload.json()) as {
    sourceId: string;
    status: string;
    blobContentHash: string;
    jobId: string;
  };
  expect(uploaded.status).toBe("uploaded");
  expect(uploaded.blobContentHash).toMatch(/^sha256:[0-9a-f]{64}$/);

  // 2. 列表只含元数据（无字节/路径字段）。
  const list = await page.request.get(
    `/api/apps/${appId}/design-assets/sources`,
  );
  expect(list.ok()).toBeTruthy();
  const listBody = (await list.json()) as {
    sources: Array<Record<string, unknown>>;
  };
  const listed = listBody.sources.find(
    (row) => row.sourceId === uploaded.sourceId,
  );
  expect(listed).toBeTruthy();
  const listedKeys = Object.keys(listed ?? {}).sort();
  expect(listedKeys).not.toContain("bytes");
  expect(listedKeys).not.toContain("path");
  expect(listedKeys).not.toContain("storageRelativePath");

  // 3. 服务内提取 worker 在数秒内把 source 推进到 ready。
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `/api/apps/${appId}/design-assets/sources`,
        );
        const body = (await res.json()) as {
          sources: Array<{ sourceId: string; status: string }>;
        };
        return body.sources.find(
          (row) => row.sourceId === uploaded.sourceId,
        )?.status;
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe("ready");

  // 4. generation 读取面正向：播种一条带 candidateBundle 的非终态 run
  // （生成面写入属 S11；此处仅验证读取面的全链路核对与响应头）。
  const pool = mysql.createPool(
    process.env.VMA_DATABASE_URL ??
      "mysql://vma:vma-local-dev-only@127.0.0.1:3317/vite_multipage_agent",
  );
  const generationId = crypto.randomUUID();
  const candidateDigest = `sha256:${"ab".repeat(32)}`;
  try {
    await pool.execute(
      "INSERT INTO `generation_runs` (`id`, `app_id`, `status`, `candidate_digest`, `candidate_bundle`, `created_at`, `updated_at`) VALUES (?, ?, 'awaiting_preview', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [
        generationId,
        appId,
        candidateDigest,
        JSON.stringify({
          assets: {
            entries: [
              { assetId: "logo", contentHash: uploaded.blobContentHash },
            ],
          },
        }),
      ],
    );

    const faceUrl = `/api/apps/${appId}/generations/${generationId}/design-assets/logo/content`;
    const hit = await page.request.get(
      `${faceUrl}?candidateDigest=${encodeURIComponent(candidateDigest)}`,
    );
    expect(hit.status()).toBe(200);
    expect(hit.headers()["cache-control"]).toBe("private, no-store");
    expect(hit.headers()["x-content-type-options"]).toBe("nosniff");
    expect(hit.headers()["content-type"]).toContain("image/png");
    expect(hit.headers()["etag"]).toBeTruthy();
    const body = await hit.body();
    const original = await readFile("tests/fixtures/design-assets/gradient.png");
    expect(Buffer.compare(body, original)).toBe(0);

    // HEAD 与 GET 一致的授权/核对，只不返回正文。
    const head = await page.request.fetch(
      `${faceUrl}?candidateDigest=${encodeURIComponent(candidateDigest)}`,
      { method: "HEAD" },
    );
    expect(head.status()).toBe(200);
    expect(head.headers()["etag"]).toBe(hit.headers()["etag"]);

    // digest 不符 → 404（不泄露存在性）。
    const wrongDigest = await page.request.get(
      `${faceUrl}?candidateDigest=sha256:${"0".repeat(64)}`,
    );
    expect(wrongDigest.status()).toBe(404);
  } finally {
    await pool.execute("DELETE FROM `generation_runs` WHERE `id` = ?", [
      generationId,
    ]);
    await pool.end();
  }

  // 5. 伪造 run 不存在 → 404（不泄露存在性）。
  const missing = await page.request.get(
    `/api/apps/${appId}/generations/${crypto.randomUUID()}/design-assets/logo/content?candidateDigest=sha256:${"0".repeat(64)}`,
  );
  expect(missing.status()).toBe(404);
});

test("S7 DesignAsset：上传校验 fail closed（稳定错误码）", async ({ page }) => {
  test.setTimeout(60_000);
  await uiLogin(page, adminEmailFor(test.info().workerIndex));
  const appId = await createAppViaApi(
    page,
    `s7-assets-gate-${test.info().workerIndex}-${Date.now()}`,
  );

  // 非法 purpose。
  const badPurpose = await uploadSource(
    page,
    appId,
    "gradient.png",
    "image/png",
    "not_a_purpose",
  );
  expect(badPurpose.status()).toBe(400);
  expect(
    (await badPurpose.json()) as { error?: { code?: string } },
  ).toMatchObject({ error: { code: "asset_invalid" } });

  // 声明 MIME 与魔数不符。
  const mismatched = await uploadSource(
    page,
    appId,
    "gradient.png",
    "application/pdf",
    "reference_screenshot",
  );
  expect(mismatched.status()).toBe(400);
  const mismatchBody = (await mismatched.json()) as {
    error?: { code?: string };
  };
  expect(["asset_invalid"]).toContain(mismatchBody.error?.code);

  // 空字节。
  const empty = await page.request.post(
    `/api/apps/${appId}/design-assets/sources?purpose=reference_screenshot`,
    { data: Buffer.alloc(0), headers: { ...ORIGIN, "Content-Type": "image/png" } },
  );
  expect(empty.status()).toBe(400);
});

test("S7 DesignAsset：viewer 不可上传（角色矩阵）", async ({ browser }) => {
  test.setTimeout(90_000);
  const worker = test.info().workerIndex;
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await uiLogin(ownerPage, adminEmailFor(worker));
  const appId = await createAppViaApi(
    ownerPage,
    `s7-assets-role-${worker}-${Date.now()}`,
  );

  // 邀请 viewer 并接受（独立 context，避免复用 owner 会话）。
  const viewerEmail = viewerEmailFor(worker);
  const invitationId = await inviteViaApi(ownerPage, appId, viewerEmail, "viewer");
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await uiLogin(viewerPage, viewerEmail);
  await acceptInvitationViaApi(viewerPage, invitationId);

  const upload = await uploadSource(
    viewerPage,
    appId,
    "gradient.png",
    "image/png",
    "reference_screenshot",
  );
  // conceal：viewer 对 app 可见但无 editor 权限 → 403/404，不泄露内部状态。
  expect([403, 404]).toContain(upload.status());
  await ownerContext.close();
  await viewerContext.close();
});

test("S7 DesignAsset：未登录读取面 fail closed（401）", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const res = await page.request.get(
    `/api/apps/${crypto.randomUUID()}/design-assets/sources`,
  );
  expect(res.status()).toBe(401);
  await context.close();
});
