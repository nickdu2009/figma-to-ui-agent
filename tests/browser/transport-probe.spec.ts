import { expect, test } from "@playwright/test";

/**
 * Transport 探针（计划 §5 末尾 / §10 步骤 0 / §14 G1）：
 * 文本透传、ask_question interrupt/resume、spec.patch.* CUSTOM
 * 透传（含 >1KB 首块的 SSE 不缓冲验证）、await_apply_result 前端工具往返。
 */
test("transport probe: text, interrupt/resume, CUSTOM patch stream, apply result", async ({
  page,
}) => {
  page.on("console", (msg) =>
    console.log("[browser]", msg.type(), msg.text().slice(0, 300)),
  );
  page.on("pageerror", (err) =>
    console.log("[pageerror]", err.message.slice(0, 500)),
  );
  page.on("response", (res) => {
    if (res.url().includes("/api/copilotkit")) {
      console.log("[net]", res.status(), res.url());
    }
  });
  await page.goto("/probe.html");

  // run 1：发送消息 -> 文本片段 + 决策 interrupt。
  const input = page.locator("textarea").first();
  await input.fill("start probe");
  await input.press("Enter");

  await expect(page.getByText("probe stage 1: text chunk")).toBeVisible();
  const interruptCard = page.getByTestId("probe-interrupt");
  await expect(interruptCard).toBeVisible();

  // 用户 resolve -> run 2（resume）发出 CUSTOM patch 流 + await_apply_result。
  await page.getByTestId("probe-approve").click();

  const log = page.getByTestId("probe-custom-log");
  await expect(log.locator('[data-name="spec.patch.finish"]')).toHaveCount(1, {
    timeout: 15_000,
  });

  const entries = await log.locator("[data-name]").evaluateAll((els) =>
    els.map((el) => ({
      name: el.getAttribute("data-name") ?? "",
      at: Number(el.getAttribute("data-at") ?? "0"),
      bytes: Number(el.getAttribute("data-bytes") ?? "0"),
    })),
  );
  const deltas = entries.filter((e) => e.name === "spec.patch.delta");
  const finish = entries.find((e) => e.name === "spec.patch.finish");
  expect(entries.some((e) => e.name === "spec.patch.start")).toBe(true);
  expect(deltas.length).toBeGreaterThanOrEqual(2);
  expect(finish).toBeTruthy();

  // 首个 delta >1KB（压缩激活边界）且与 finish 存在明显时间差 -> SSE 未被缓冲。
  expect(deltas[0]!.bytes).toBeGreaterThan(1024);
  expect(finish!.at - deltas[0]!.at).toBeGreaterThan(150);

  // await_apply_result 前端工具 handler 在本地流关闭后返回 committed。
  await expect(page.getByTestId("probe-apply-result")).toContainText(
    '"status":"committed"',
  );

  // run 3：工具结果随下一次 run 回到 Agent 并回显。
  await expect(page.getByText(/apply result received:/)).toBeVisible();
});
