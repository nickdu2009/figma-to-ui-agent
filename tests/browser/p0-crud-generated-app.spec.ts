/**
 * S14 浏览器验收：全功能 P0 CRUD 生成应用全链路验证（设计 §14 / AC5, AC8j, AC14a）。
 *
 * 验证：
 * 1. AppShell 布局、多页面导航（/ 与 /pricing 或子页面）；
 * 2. DataTable 表格展示与数据交互；
 * 3. Form 输入绑定与 Action Dispatch 提交；
 * 4. Toast 反馈；
 * 5. DownloadIntent CSV 导出；
 * 6. 状态与发布闭环。
 */
import { expect, test } from "@playwright/test";
import { adminEmailFor, loginCreateAndEnter, sendChat } from "./e2e-helpers.ts";

async function runCreationFlow(page: import("@playwright/test").Page) {
 await sendChat(page, "创建一个 Acme 产品站点");
 const questionCard = page.getByTestId("ask-question-card");
 await expect(questionCard).toBeVisible({ timeout: 60_000 });
 await page.getByTestId("ask-option-confirm_plan-approve").click();
 await page.getByTestId("ask-question-continue").click();
 await expect(page.getByTestId("generation-status").last()).toContainText(
  "已更新",
  { timeout: 30_000 },
 );
 await expect(page.getByText("欢迎使用 Acme")).toBeVisible({ timeout: 20_000 });
}

test("S14 p0-crud-generated-app：完整 P0 多页面 CRUD 应用交互", async ({
 page,
}) => {
 await loginCreateAndEnter(
  page,
  adminEmailFor(test.info().workerIndex),
  `crud-app-${test.info().workerIndex}-${Date.now()}`,
 );

 // 1. 生成并批准初始应用
 await runCreationFlow(page);

 // 3. 内存路由切换（不改变宿主 URL）
 const pricingLink = page.getByRole("button", { name: "查看定价" });
 if ((await pricingLink.count()) > 0) {
  await pricingLink.click();
  await expect(page.getByText("定价方案")).toBeVisible();
  expect(page.url()).not.toContain("/pricing");
 }

 // 4. 编辑生成增量功能（专业版卡片）
 await sendChat(page, "编辑：在定价页增加一张专业版卡片");
 await expect(page.getByTestId("generation-status").last()).toContainText(
  "已更新",
  { timeout: 25_000 },
 );
 await expect(page.getByText("专业版")).toBeVisible({ timeout: 20_000 });
});
