/**
 * S8：持久化平台端到端场景（mock 模式，不调 LLM）。
 * 覆盖：UI 登录 → 创建应用 → 生成 → 草稿 → 显式发布 → 刷新恢复 →
 * 二次发布 → 回滚 → 邀请成员 → 角色矩阵（editor/viewer）→ 删除/恢复。
 * 对应 AC1、AC2、AC3、AC4、AC7。
 */
import { expect, test } from "@playwright/test";
import {
  adminEmailFor,
  editorEmailFor,
  sendChat,
  viewerEmailFor,
  enterApp,
  acceptInvitationViaApi,
  inviteViaApi,
  loginCreateAndEnter,
  uiLogin,
} from "./e2e-helpers.ts";

/** 走一遍 mock 创建流（聊天 → 批准计划 → committed 预览）。 */
async function runMockGeneration(page: import("@playwright/test").Page) {
  await sendChat(page, "创建一个 Acme 应用");
  // 冷启动（Vite 依赖预构建 + 服务器动态导入）可能超过 15s，
  // 与 agent-flow.spec.ts 的 runCreationFlow 对齐给足余量。
  await expect(page.getByTestId("ask-question-card")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("ask-option-confirm_plan-approve").click();
  await page.getByTestId("ask-question-continue").click();
  await expect(page.getByTestId("generation-status")).toContainText(
    /已更新|已应用|committed/i,
    { timeout: 20_000 },
  );
}

test("S8 场景：登录→生成→发布→刷新恢复→二次发布→回滚（AC1/AC3/AC4）", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // 1. UI 登录 + UI 创建应用（唯一命名：共享 dev DB 会累积历次运行数据）
  const appName = `s8-app-${Date.now()}`;
  await uiLogin(page, adminEmailFor(test.info().workerIndex));
  await page.getByTestId("app-gate").getByRole("textbox").fill(appName);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByTestId("app-shell")).toBeVisible();

  // 2. mock 生成 → 草稿产生但不自动发布（AC3）
  await runMockGeneration(page);
  await page.getByTestId("tab-release").click();
  await expect(page.getByTestId("release-panel")).toBeVisible();
  await expect(page.getByTestId("versions-empty")).toBeVisible();
  const drafts = page.locator("[data-testid^='draft-']");
  await expect(drafts.first()).toBeVisible();
  const draftTestId = await drafts.first().getAttribute("data-testid");
  const draftId = draftTestId!.replace("draft-", "");

  // 3. owner 显式发布 v1
  await page.getByTestId(`publish-${draftId}`).click();
  await expect(page.locator("[data-testid^='version-']").first()).toBeVisible({
    timeout: 10_000,
  });

  // 4. 浏览器刷新：预览由已发布版本恢复（AC1）
  const previewText = await page.getByTestId("preview-panel").innerText();
  await page.reload();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("preview-panel")).toContainText("Acme", {
    timeout: 15_000,
  });
  expect(previewText).toContain("Acme");

  // 5. 二次生成 → 发布 v2 → 发布历史两个版本
  await runMockGeneration(page);
  await page.getByTestId("tab-release").click();
  const drafts2 = page.locator("[data-testid^='draft-']");
  await expect(drafts2.first()).toBeVisible();
  const draftId2 = (await drafts2.first().getAttribute("data-testid"))!.replace(
    "draft-",
    "",
  );
  await page.getByTestId(`publish-${draftId2}`).click();
  await expect(page.locator("[data-testid^='version-']")).toHaveCount(2, {
    timeout: 10_000,
  });

  // 6. 回滚到 v1（AC4：当前版本不在回滚按钮上）
  const rollbackButtons = page.locator("[data-testid^='rollback-']");
  await expect(rollbackButtons).toHaveCount(1);
  await rollbackButtons.first().click();
  await expect(page.locator("[data-testid^='version-']")).toHaveCount(2, {
    timeout: 10_000,
  });
  // 回滚后刷新，预览仍正常恢复
  await page.reload();
  await expect(page.getByTestId("preview-panel")).toContainText("Acme", {
    timeout: 15_000,
  });
});

test("S8 场景：邀请成员与角色矩阵（AC2）", async ({ browser }) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const ownerEmail = adminEmailFor(test.info().workerIndex);
  const editorEmail = editorEmailFor(test.info().workerIndex);
  const viewerEmail = viewerEmailFor(test.info().workerIndex);
  const appId = await loginCreateAndEnter(
    ownerPage,
    ownerEmail,
    `s8-roles-app-${Date.now()}`,
  );

  // owner：聊天 + 三个标签
  await expect(ownerPage.getByTestId("chat-panel")).toBeVisible();
  await expect(ownerPage.getByTestId("tab-data")).toBeVisible();
  await expect(ownerPage.getByTestId("tab-release")).toBeVisible();
  await expect(ownerPage.getByTestId("tab-bin")).toBeVisible();

  // editor：数据标签可见，发布/回收站/聊天不可见
  const editorContext = await browser.newContext();
  const editorPage = await editorContext.newPage();
  // 顺序（S2 授权）：必须先有有效邀请，被邀请邮箱才具备登录资格
  const editorInviteId = await inviteViaApi(
    ownerPage,
    appId,
    editorEmail,
    "editor",
  );
  await uiLogin(editorPage, editorEmail);
  await acceptInvitationViaApi(editorPage, editorInviteId);
  await enterApp(editorPage, appId);
  await expect(editorPage.getByTestId("tab-data")).toBeVisible();
  await expect(editorPage.getByTestId("tab-release")).toHaveCount(0);
  await expect(editorPage.getByTestId("tab-bin")).toHaveCount(0);
  await expect(editorPage.getByTestId("chat-panel")).toHaveCount(0);

  // viewer：只有只读预览
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  const viewerInviteId = await inviteViaApi(
    ownerPage,
    appId,
    viewerEmail,
    "viewer",
  );
  await uiLogin(viewerPage, viewerEmail);
  await acceptInvitationViaApi(viewerPage, viewerInviteId);
  await enterApp(viewerPage, appId);
  await expect(viewerPage.getByTestId("preview-panel")).toBeVisible();
  await expect(viewerPage.getByTestId("tab-data")).toHaveCount(0);
  await expect(viewerPage.getByTestId("chat-panel")).toHaveCount(0);

  // 服务端授权事实：viewer 直接请求草稿列表必须 404（绕过 UI）
  const draftsRes = await viewerPage.request.get(`/api/apps/${appId}/drafts`);
  expect(draftsRes.status()).toBe(404);
  const publishRes = await viewerPage.request.post(
    `/api/apps/${appId}/releases/publish`,
    { data: { draftId: "any" }, headers: { Origin: "http://127.0.0.1:3100" } },
  );
  expect(publishRes.status()).toBe(404);

  await ownerContext.close();
  await editorContext.close();
  await viewerContext.close();
});

test("S8 场景：应用删除进回收站与治理恢复（AC7）", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const binAppName = `s8-bin-app-${Date.now()}`;
  const appId = await loginCreateAndEnter(
    page,
    adminEmailFor(test.info().workerIndex),
    binAppName,
  );

  // owner 删除应用（UI 确认流）
  await page.getByTestId("tab-bin").click();
  await page.getByTestId("app-delete-open").click();
  await page.getByTestId("app-delete-confirm-yes").click();
  // 删除后回到应用门，列表为空
  await expect(page.getByTestId("app-gate")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("app-list")).not.toContainText(binAppName);

  // 正常路由全部关闭（授权事实在服务端）
  for (const path of [
    `/api/apps/${appId}/drafts`,
    `/api/apps/${appId}/releases/current`,
  ]) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(404);
  }

  // 管理员通过治理端点恢复
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await uiLogin(adminPage, adminEmailFor(test.info().workerIndex));
  const restore = await adminPage.request.post(
    `/api/platform/apps/${appId}/restore`,
    { data: {}, headers: { Origin: "http://127.0.0.1:3100" } },
  );
  expect(restore.status()).toBe(200);

  // 恢复后应用重新出现且可进入
  await enterApp(page, appId);
  await expect(page.getByTestId("preview-panel")).toBeVisible();
  await adminContext.close();
});
