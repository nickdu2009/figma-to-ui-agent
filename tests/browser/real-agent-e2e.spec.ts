import { expect, test } from "@playwright/test";
import { loginCreateAndEnter, sendChat } from "./e2e-helpers.ts";

async function approveQuestionnaire(page: import("@playwright/test").Page) {
  const card = page.getByTestId("ask-question-card");
  for (let step = 0; step < 4; step += 1) {
    if (!(await card.isVisible().catch(() => false))) return;
    const approve = card.locator('[data-testid*="approve"]').first();
    if (await approve.count()) {
      await approve.click();
    } else {
      await card.getByRole("radio").first().click();
    }
    await card.getByTestId("ask-question-continue").click();
    await page.waitForTimeout(250);
  }
  await expect(card).toHaveCount(0);
}

test("真实 Agent：Chat → generate_spec → validation → Preview Commit", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // await_apply_result 是协议内部回执。它必须由服务端确定性收尾，不能再
  // 作为未知 ToolMessage 送入真实模型而在浏览器形成 agent_run_failed。
  const protocolFailures: string[] = [];
  const agentResponseStatuses: number[] = [];
  const agentTransportFailures: string[] = [];
  const activeAgentRequests = new Set<import("@playwright/test").Request>();
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("agent_run_failed")) protocolFailures.push("agent_run_failed");
    if (text.includes("Agent error: network error"))
      protocolFailures.push("agent_network_error");
  });
  page.on("pageerror", () => protocolFailures.push("pageerror"));
  page.on("response", (response) => {
    if (response.url().includes("/api/copilotkit/agent/chat/run")) {
      agentResponseStatuses.push(response.status());
    }
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/copilotkit/agent/chat/run")) {
      activeAgentRequests.add(request);
    }
  });
  page.on("requestfinished", (request) => activeAgentRequests.delete(request));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/copilotkit/agent/chat/run")) {
      agentTransportFailures.push(request.failure()?.errorText ?? "unknown");
    }
    activeAgentRequests.delete(request);
  });

  const appId = await loginCreateAndEnter(
    page,
    "real-agent-e2e@example.com",
    `real-agent-e2e-${Date.now()}`,
  );

  await sendChat(
    page,
    "创建一个最小单页应用：首页显示“真实模型验收”标题和一段说明。不要图片、表单、业务数据或自定义 Action。请先给出简短计划并请求批准；批准后调用 generate_spec。",
  );

  await expect(page.getByTestId("ask-question-card")).toBeVisible({
    timeout: 90_000,
  });
  await approveQuestionnaire(page);

  const status = page.getByTestId("generation-status").last();
  await expect(status).toContainText("已更新", { timeout: 180_000 });
  await expect(page.getByTestId("preview-empty")).toHaveCount(0);
  // Preview Commit 先于聊天模型的最终 RUN_FINISHED 到达。若此处立刻刷新，
  // 浏览器会主动 abort SSE，CopilotKit 会如实上报 agent_run_failed；等待
  // 当前 agent 请求自然结束，才能验证真实的协议收尾而不是测试自身的中止。
  await expect
    .poll(() => activeAgentRequests.size, { timeout: 60_000 })
    .toBe(0);

  // Preview Commit 必须在服务器创建 Draft；切换到发布面读取草稿作为持久化证据。
  await page.getByTestId("tab-release").click();
  await expect(page.locator("[data-testid^='draft-']").first()).toBeVisible({
    timeout: 20_000,
  });

  // 刷新后仍从服务端草稿恢复 Preview，而不是依赖聊天/内存状态。
  await page.reload();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("preview-empty")).toHaveCount(0);

  const drafts = await page.request.get(`/api/apps/${appId}/drafts`);
  expect(drafts.ok()).toBe(true);
  const body = (await drafts.json()) as { drafts?: unknown[] };
  expect(body.drafts?.length).toBeGreaterThanOrEqual(1);
  expect({ protocolFailures, agentResponseStatuses, agentTransportFailures }).toEqual({
    protocolFailures: [],
    agentResponseStatuses: expect.arrayContaining([200]),
    agentTransportFailures: [],
  });
});
