import { expect, test } from "@playwright/test";
import {
 createAppViaApi,
 adminEmailFor,
 loginCreateAndEnter,
 sendChat,
} from "./e2e-helpers.ts";

/**
 * Mock 全链路浏览器验收（计划 §10 步骤 7，VMA_AGENT_MODE=mock，不调 LLM）：
 *
 * - 创建全流程：聊天 -> ask_question 问卷 interrupt ->
 *   批准 -> spec.patch.* 流 -> applySource committed -> 卡片“已更新” ->
 *   预览渲染三路由应用；
 * - 编辑：direct_edit base=current 增量卡片出现在 /pricing；
 * - 坏补丁：applySource 拒绝 -> 卡片“更新失败”且预览保留最后一份有效内容；
 * - 问答路径：纯文本回答，不触发任何生成卡。
 *
 * 注意：每个测试独立浏览器上下文（运行时状态按页面隔离），需要
 * 已有应用的用例会先快速走一遍创建流程（Mock 约 1s）。
 */

async function runCreationFlow(page: import("@playwright/test").Page) {
 await sendChat(page, "创建一个 Acme 产品站点");

 // run1：普通聊天消息中的计划 + question 作答控件（ask_question interrupt）。首个用例冷启动
 //（Vite 依赖预构建 + 服务器动态导入 + S5 后 81 组件目录派生）可能超过 5s，
 // 给足余量（与 persistence.spec 对齐；S5 后冷启动变慢，提至 45s）。
 const questionCard = page.getByTestId("ask-question-card");
 await expect(questionCard).toBeVisible({ timeout: 45_000 });
 await expect(page.getByText("构建 Acme 产品站点")).toBeVisible();
 await expect(page.getByText("首页、定价、文档")).toBeVisible();
 await expect(questionCard).toContainText("是否按这个计划开始生成？");

 // 批准 -> run2 流式补丁 -> await_apply_result -> committed。
 await page.getByTestId("ask-option-confirm_plan-approve").click();
 await page.getByTestId("ask-question-continue").click();
 await expect(page.getByTestId("generation-status").last()).toContainText(
  "已更新",
  { timeout: 20_000 },
 );
 // apply 工具结果不得作为原始协议 JSON 泄漏进对话。
 await expect(page.getByTestId("chat-panel")).not.toContainText("应用结果：{");
 await expect(page.getByTestId("chat-panel")).not.toContainText("mock-gen-");

 // 预览渲染根路由。
 await expect(page.getByText("欢迎使用 Acme")).toBeVisible();
}

test("creation flow: chat -> plan card -> approve -> patch stream -> committed preview", async ({
  page,
}) => {
 page.on("pageerror", (err) =>
  console.log("[pageerror]", err.message.slice(0, 500)),
 );
 await loginCreateAndEnter(
  page,
  adminEmailFor(test.info().workerIndex),
  "flow-app-1",
 );
 await expect(page.getByTestId("chat-panel")).toBeVisible();
 await expect(page.getByTestId("preview-panel")).toBeVisible();

 await runCreationFlow(page);

 // 预览壳 revision 已推进（创建提交）。
 const revision = await page.evaluate(() => {
  const runtime = (
   window as unknown as {
    __previewRuntime: {
     getSnapshot: () => { revision: number; current: unknown };
    };
   }
  ).__previewRuntime;
  return runtime.getSnapshot().revision;
 });
 expect(revision).toBeGreaterThanOrEqual(1);

 // Draft 是编辑态的恢复事实：刷新后不能丢失刚刚生成的 Preview。
 await page.reload();
 await expect(
  page.getByTestId("preview-panel").getByText("欢迎使用 Acme"),
 ).toBeVisible();
});

test("navigation: built-in Link routes inside preview", async ({ page }) => {
 await loginCreateAndEnter(
  page,
  adminEmailFor(test.info().workerIndex),
  "flow-app-2",
 );
 await runCreationFlow(page);

 // 运行时内置 Link 导航到 /pricing。
 await page.getByRole("link", { name: "定价" }).click();
 await expect(page.getByText("基础版")).toBeVisible();
 await expect(page.getByText("适合个人开发者")).toBeVisible();

 // 回首页。
 await page.getByRole("link", { name: "首页" }).click();
 await expect(page.getByText("欢迎使用 Acme")).toBeVisible();
});

test("edit flow: direct_edit base=current appends a card on /pricing", async ({
 page,
}) => {
 await loginCreateAndEnter(
  page,
  adminEmailFor(test.info().workerIndex),
  "flow-app-3",
 );
 await runCreationFlow(page);

 await page.getByRole("link", { name: "定价" }).click();
 await expect(page.getByText("基础版")).toBeVisible();

 const statuses = page.getByTestId("generation-status");
 const priorGenerationCount = await statuses.count();
 await sendChat(page, "编辑：在定价页增加一张专业版卡片");
 await expect(statuses).toHaveCount(priorGenerationCount + 1, {
  timeout: 20_000,
 });
 const generationStatus = statuses.last();
 await expect(generationStatus).toBeVisible({ timeout: 20_000 });
 // Patch 尚在流入时，浏览器只缓存它；旧预览不能出现中间 candidate。
 await expect(
  page.getByTestId("preview-panel").getByText("专业版"),
 ).not.toBeVisible();
 await expect(generationStatus).toContainText("已更新", { timeout: 20_000 });

 // 增量补丁生效：第二张卡片出现，第一张仍在（断言限定在预览面板内，
 // 避免匹配到聊天消息与折叠 Patch 日志中的同名字符串）。
 const preview = page.getByTestId("preview-panel");
 await expect(preview.getByText("专业版")).toBeVisible();
 await expect(preview.getByText("适合成长中的团队")).toBeVisible();
 await expect(preview.getByText("基础版")).toBeVisible();
 await expect(page.getByTestId("preview-content")).toHaveClass(
  "preview-content-enter",
 );
});

test("broken patch: rejected, preview keeps last valid, card shows failure", async ({
 page,
}) => {
 await loginCreateAndEnter(
  page,
  adminEmailFor(test.info().workerIndex),
  "flow-app-4",
 );
 await runCreationFlow(page);

 await sendChat(page, "坏补丁演示");
 await expect(page.getByTestId("generation-status").last()).toContainText(
  "更新失败",
  { timeout: 20_000 },
 );

 // 预览保留最后一份有效内容（根路由仍可渲染）。
 await expect(
  page.getByTestId("preview-panel").getByText("欢迎使用 Acme"),
 ).toBeVisible();

 // rejected 后 await_apply_result 会立即 resolve；后续普通 run 必须可用，
 // 不能遗留未处理 interrupt 或让页面陷入重试/渲染循环。
 await sendChat(page, "问答：当前有哪些页面？");
 await expect(page.getByText("当前应用有首页、定价和文档三个页面")).toBeVisible(
  { timeout: 20_000 },
 );
});

test("qa path: plain text answer without generation card", async ({ page }) => {
 await loginCreateAndEnter(
  page,
  adminEmailFor(test.info().workerIndex),
  "flow-app-5",
 );
 await expect(page.getByTestId("chat-panel")).toBeVisible();

 await sendChat(page, "问答：当前有哪些页面？");
 await expect(
  page.getByText("当前应用有首页、定价和文档三个页面"),
 ).toBeVisible();

 // 问答路径不产生任何生成卡。
 await expect(page.getByTestId("generation-status")).toHaveCount(0);
});

test("ask_question: 多题问卷按页作答并以 answers 恢复 Agent", async ({
 page,
}) => {
 await loginCreateAndEnter(
  page,
  adminEmailFor(test.info().workerIndex),
  "flow-app-6",
 );
 await sendChat(page, "多题问卷");
 const card = page.getByTestId("ask-question-card");
 await expect(card).toContainText("主要给谁使用？", { timeout: 20_000 });
 await expect(card).toContainText("1 of 2");
 await page.getByTestId("ask-option-audience-individual").click();
 await page.getByTestId("ask-question-continue").click();
 await expect(card).toContainText("首版做到哪一档？");
 await expect(card).toContainText("2 of 2");
 await page.getByTestId("ask-option-scope-mvp").click();
 await page.getByTestId("ask-question-continue").click();
 await expect(page.getByText("已收到两项回答，将据此继续规划。")).toBeVisible();
 await expect(page.getByTestId("ask-question-summary")).toContainText(
  "已回答 2 个问题",
 );
 await page.getByTestId("ask-question-summary").getByRole("button").click();
 const summary = page.getByTestId("ask-question-summary-details");
 await expect(summary).toContainText("主要给谁使用？");
 await expect(summary).toContainText("个人用户");
 await expect(summary).toContainText("首版做到哪一档？");
 await expect(summary).toContainText("标准 MVP");
});

test("abort: stop mid-stream aborts applySource and keeps last valid preview", async ({
 page,
}) => {
 await loginCreateAndEnter(
  page,
  adminEmailFor(test.info().workerIndex),
  "flow-app-7",
 );
 await runCreationFlow(page);

 // 发起编辑生成，等生成卡进入流式状态后点击停止。
 // 发送/停止是同一个按钮（copilot-send-button）：输入未清空时是发送模式，
 // 运行中才渲染 Square 图标进入停止模式——必须等 svg 出现再点击，
 // 否则会误发一条重复消息而不是中止。
 const statuses = page.getByTestId("generation-status");
 const priorGenerationCount = await statuses.count();
 await sendChat(page, "编辑：在定价页增加一张专业版卡片");
 await expect(statuses).toHaveCount(priorGenerationCount + 1, {
  timeout: 15_000,
 });
 const status = statuses.last();
 await expect(status).toBeVisible({ timeout: 15_000 });
 const stopButton = page.getByTestId("copilot-send-button");
 await expect(stopButton.locator("svg")).toBeVisible({ timeout: 10_000 });
 await stopButton.click();

 // 补丁流未完成 -> applySource 被中止 -> 卡片显示失败而非“已更新”。
 await expect(status).toContainText("更新失败", { timeout: 15_000 });
 await expect(status).not.toContainText("已更新");

 // 界面回到稳定态：预览仍是创建流程提交的版本，定价页没有新卡片。
 //（断言限定在预览面板内：聊天记录与 Patch 日志含同名字符串。）
 const preview = page.getByTestId("preview-panel");
 await expect(preview.getByText("欢迎使用 Acme")).toBeVisible();
 await page.getByRole("link", { name: "定价" }).click();
 await expect(preview.getByText("基础版")).toBeVisible();
 await expect(preview.getByText("专业版")).not.toBeVisible();
});

test("switching apps creates an isolated Preview runtime and does not restore the old app", async ({
 page,
}) => {
 const email = adminEmailFor(test.info().workerIndex);
 await loginCreateAndEnter(page, email, "runtime-source-app");
 await runCreationFlow(page);
 await expect(
  page.getByTestId("preview-panel").getByText("欢迎使用 Acme"),
 ).toBeVisible();

 const targetName = `runtime-target-${Date.now()}`;
 await createAppViaApi(page, targetName);
 await page.getByRole("button", { name: "切换应用" }).click();

 // LAST_APP_KEY 若未清除，恢复 effect 会立刻把旧应用重新选中。
 await expect(page.getByTestId("app-gate")).toBeVisible();
 await page
  .getByTestId("app-list")
  .getByRole("button", { name: new RegExp(targetName) })
  .click();
 await expect(page.getByTestId("current-app-name")).toHaveText(targetName);
 await expect(page.getByTestId("preview-empty")).toBeVisible();
 await expect(
  page.getByTestId("preview-panel").getByText("欢迎使用 Acme"),
 ).toHaveCount(0);
});

test("login does not claim an OTP was sent when the auth endpoint rejects the request", async ({
 page,
}) => {
 await page.route("**/api/auth/start", async (route) => {
  await route.fulfill({
   status: 403,
   contentType: "application/json",
   body: JSON.stringify({ error: { message: "请求被安全策略拒绝" } }),
  });
 });
 await page.goto("/");
 await page
  .getByTestId("login-page")
  .getByRole("textbox")
  .fill("feedback@example.com");
 await page.getByRole("button", { name: "发送验证码" }).click();
 await expect(page.getByTestId("login-error")).toHaveText("请求被安全策略拒绝");
 await expect(page.getByTestId("otp-hint")).toHaveCount(0);
 await expect(page.getByTestId("dev-otp")).toHaveCount(0);
});
