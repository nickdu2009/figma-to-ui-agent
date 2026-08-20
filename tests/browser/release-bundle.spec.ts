/**
 * S13 浏览器验收：Bundle 发布与发布版本预览加载（设计 §4.2/§13.2.1）。
 *
 * 验证：
 * 1. 创建应用并完成生成得到草稿；
 * 2. 显式发布草稿为 PublishedVersion 并原子移动 ReleasePointer；
 * 3. /releases/current 准确返回发布版本；
 * 4. 预览视图在发布后稳定呈现已发布内容。
 */
import { expect, test } from "@playwright/test";
import { adminEmailFor, loginCreateAndEnter, sendChat } from "./e2e-helpers.ts";

async function runCreationFlow(page: import("@playwright/test").Page) {
  await sendChat(page, "创建一个 Acme 产品站点");
  const questionCard = page.getByTestId("ask-question-card");
  await expect(questionCard).toBeVisible({ timeout: 45_000 });
  await page.getByTestId("ask-option-confirm_plan-approve").click();
  await page.getByTestId("ask-question-continue").click();
  await expect(page.getByTestId("generation-status").last()).toContainText(
    "已更新",
    { timeout: 20_000 },
  );
  await expect(page.getByText("欢迎使用 Acme")).toBeVisible({
    timeout: 20_000,
  });
}

test("S13 release-bundle：生成草稿并显式发布为 PublishedVersion", async ({
  page,
}) => {
  const appId = await loginCreateAndEnter(
    page,
    adminEmailFor(test.info().workerIndex),
    `rel-app-${test.info().workerIndex}-${Date.now()}`,
  );

  // 1. 生成初始草稿
  await runCreationFlow(page);

  // 2. 获取草稿 ID 并显式发布
  const draftsRes = await page.request.get(`/api/apps/${appId}/drafts`);
  expect(draftsRes.status()).toBe(200);
  const draftsBody = (await draftsRes.json()) as {
    drafts: Array<{ id: string; status: string }>;
  };
  expect(draftsBody.drafts.length).toBeGreaterThanOrEqual(1);
  const draftId = draftsBody.drafts[0]!.id;

  const pubRes = await page.request.post(
    `/api/apps/${appId}/releases/publish`,
    {
      headers: { Origin: "http://127.0.0.1:3100" },
      data: { draftId },
    },
  );
  expect(pubRes.status()).toBe(200);
  const pubBody = (await pubRes.json()) as { publishedVersionId: string };
  expect(pubBody.publishedVersionId).toBeTruthy();

  // 3. 验证 /releases/current 返回发布版本
  const curRes = await page.request.get(`/api/apps/${appId}/releases/current`);
  expect(curRes.status()).toBe(200);
  const curBody = (await curRes.json()) as {
    current: { publishedVersionId: string; spec: unknown } | null;
  };
  expect(curBody.current?.publishedVersionId).toBe(pubBody.publishedVersionId);
  expect(curBody.current?.spec).toBeDefined();

  // 4. 预览呈现已发布应用根路由
  await expect(page.getByText("欢迎使用 Acme")).toBeVisible();
});
