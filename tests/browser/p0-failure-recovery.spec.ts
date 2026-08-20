/**
 * S14 浏览器验收：失败恢复、坏补丁与断流后无挂起（设计 §14 / AC22）。
 *
 * 验证：
 * 1. 坏补丁导致 staging 失败时，候选事务自动销毁，保留上一 revision；
 * 2. 失败后无 pending interrupt、无隐式 retry、无死循环；
 * 3. 失败后可立即发起新的 generation 并成功提交。
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
  await expect(page.getByText("欢迎使用 Acme")).toBeVisible({
    timeout: 20_000,
  });
}

test("S14 p0-failure-recovery：坏补丁拒绝后保留原状态并可发起新生成", async ({
  page,
}) => {
  await loginCreateAndEnter(
    page,
    adminEmailFor(test.info().workerIndex),
    `fail-rec-${test.info().workerIndex}-${Date.now()}`,
  );

  // 1. 先生成基线应用
  await runCreationFlow(page);

  // 2. 发送导致坏补丁的指令
  await sendChat(page, "坏补丁演示");
  // 校验 generation-status 呈现失败/拒绝状态
  await expect(page.getByTestId("generation-status").last()).toContainText(
    "更新失败",
    { timeout: 20_000 },
  );

  // 3. 原有预览依然完好
  await expect(page.getByText("欢迎使用 Acme")).toBeVisible();

  // 4. 立即发起新的正常生成（无需刷新页面）
  await sendChat(page, "编辑：在定价页增加一张专业版卡片");
  await expect(page.getByTestId("generation-status").last()).toContainText(
    "已更新",
    { timeout: 25_000 },
  );
});
