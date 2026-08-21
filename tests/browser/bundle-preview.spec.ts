import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { adminEmailFor, loginCreateAndEnter, sendChat } from "./e2e-helpers.ts";

const execFileAsync = promisify(execFile);

/**
 * S4 BundlePreviewController 浏览器验收（Mock，不调 LLM）：
 * - 生成流 → 候选事务提交 → active Runtime 原子切换（preview-content 以
 *   bundleRevision:revision 为 key，180ms 淡入类名保持）；
 * - 坏补丁 → 候选销毁，旧 revision 预览保留；
 * - 刷新 → PublishedPreviewLoader 经 stagePersisted(draft) 重建（Draft 是
 *   编辑态恢复事实）；
 * - Preview Route 内存导航不改宿主 URL。
 */

async function runCreationFlow(page: import("@playwright/test").Page) {
  await sendChat(page, "创建一个 Acme 产品站点");
  const questionCard = page.getByTestId("ask-question-card");
  await expect(questionCard).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("ask-option-confirm_plan-approve").click();
  await page.getByTestId("ask-question-continue").click();
  await expect(page.getByTestId("generation-status").last()).toContainText(
    "已更新",
    { timeout: 20_000 },
  );
}

test("bundle preview: generation commits via controller, active runtime switches atomically", async ({
  page,
}) => {
  await loginCreateAndEnter(
    page,
    adminEmailFor(test.info().workerIndex),
    "bpc-app-1",
  );
  await runCreationFlow(page);

  // 预览渲染（active Runtime 切换后）
  await expect(page.getByText("欢迎使用 Acme")).toBeVisible();
  const previewContent = page.getByTestId("preview-content");
  await expect(previewContent).toHaveClass("preview-content-enter");

  // window.__previewRuntime 暴露的是 Controller 的 active Runtime
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
});

test("bundle preview: bad patch destroys candidate, old revision stays interactive", async ({
  page,
}) => {
  await loginCreateAndEnter(
    page,
    adminEmailFor(test.info().workerIndex),
    "bpc-app-2",
  );
  await runCreationFlow(page);
  await expect(page.getByText("欢迎使用 Acme")).toBeVisible();

  await sendChat(page, "坏补丁演示");
  await expect(page.getByTestId("generation-status").last()).toContainText(
    "更新失败",
    { timeout: 20_000 },
  );

  // 旧 revision 预览保留且可交互（内存导航）
  await expect(
    page.getByTestId("preview-panel").getByText("欢迎使用 Acme"),
  ).toBeVisible();
  await page.getByRole("link", { name: "定价" }).click();
  await expect(page.getByText("基础版")).toBeVisible();
  // Preview Route 不改宿主 URL
  await expect(page).toHaveURL(/\/apps\/[^/]+$/);
});

test("bundle preview: reload restores draft via stagePersisted", async ({
  page,
}) => {
  await loginCreateAndEnter(
    page,
    adminEmailFor(test.info().workerIndex),
    "bpc-app-3",
  );
  await runCreationFlow(page);
  await expect(page.getByText("欢迎使用 Acme")).toBeVisible();

  await page.reload();
  // Draft 是编辑态的恢复事实：刷新后从 DraftVersion 重建（stagePersisted）。
  await expect(
    page.getByTestId("preview-panel").getByText("欢迎使用 Acme"),
  ).toBeVisible({ timeout: 15_000 });
});

test("bundle preview: runtime rebuild plus re-entry preserves the draft", async ({
  page,
}) => {
  const appName = `bpc-app-reenter-${Date.now()}`;
  await loginCreateAndEnter(
    page,
    adminEmailFor(test.info().workerIndex),
    appName,
  );
  await runCreationFlow(page);
  await expect(
    page.getByTestId("preview-panel").getByText("欢迎使用 Acme"),
  ).toBeVisible();

  // 后端重启/typecheck 等命令可能并行重建 workspace runtime。Vite 开发
  // 服务必须消费源码，不能在 dist 被清空的窗口卸载当前 Preview。
  await execFileAsync("npm", ["run", "build:runtime"], {
    cwd: process.cwd(),
  });
  await expect(
    page.getByTestId("preview-panel").getByText("欢迎使用 Acme"),
  ).toBeVisible();

  await page.getByRole("button", { name: "切换应用" }).click();
  await expect(page.getByTestId("app-gate")).toBeVisible();
  await page
    .getByTestId("app-list")
    .getByRole("button", { name: new RegExp(appName) })
    .click();

  await expect(page.getByTestId("current-app-name")).toHaveText(appName);
  await expect(
    page.getByTestId("preview-panel").getByText("欢迎使用 Acme"),
  ).toBeVisible({ timeout: 15_000 });
});
