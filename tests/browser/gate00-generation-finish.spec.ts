import { expect, test, type Page } from "@playwright/test";

/**
 * DS-GATE-00 / DSG-04：接近 2MiB 的真实 AppUiBundle 穿过当前
 * CopilotKit/AG-UI、Vite/Hono proxy 和 Chromium 的 finish 探针。
 *
 * 探针结论通过 [gate00-finish] 前缀输出到 stdout，由
 * scripts/ds-gate-00/generation-finish-probe.ts 汇总为脱敏 JSON。
 *
 * 关键测量：UTF-8 字节数、结构完整性、首事件→finish 延迟、
 * 浏览器 heap 增量；服务端 RSS 峰值由 gate00-server.mjs 记录。
 */
interface FinishMetrics {
  scenario: "probe" | "overflow";
  generationId: string;
  utf8Bytes: number;
  structureOk: boolean;
  firstEventAt: number;
  finishAt: number;
  latencyMs: number;
  heapUsedBefore: number | null;
  heapUsedAfter: number | null;
}

async function readFinishMetrics(
  page: Page,
  scenario: "probe" | "overflow",
  expectedBytes: number,
): Promise<FinishMetrics> {
  // 手动轮询：等待指标元素出现且 scenario 翻转到本轮目标
  //（元素可能残留上一轮内容）。
  const deadline = Date.now() + 60_000;
  let m: FinishMetrics | null = null;
  while (Date.now() < deadline) {
    const raw = await page
      .getByTestId("gate00-finish-metrics")
      .textContent()
      .catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as FinishMetrics;
        if (parsed.scenario === scenario) {
          m = parsed;
          break;
        }
      } catch {
        /* 元素内容不完整，继续轮询 */
      }
    }
    await page.waitForTimeout(200);
  }
  if (!m) throw new Error(`gate00 finish metrics (${scenario}) not observed`);
  // 探针输出（generation-finish-probe.ts 解析 [gate00-finish] 行）。
  console.log(`[gate00-finish] ${JSON.stringify(m)}`);
  expect(m.structureOk).toBe(true);
  // 字节数在目标 ±5% 内（JSON 封套与 padding 计算误差）。
  expect(Math.abs(m.utf8Bytes - expectedBytes)).toBeLessThan(
    expectedBytes * 0.05,
  );
  // 浏览器收到了完整、未截断、可解析的 finish 载荷。
  expect(m.utf8Bytes).toBeGreaterThan(1_000_000);
  return m;
}

test("gate00 generation finish probe: near-2MiB and overflow payloads through the real stack", async ({
  page,
}) => {
  page.on("pageerror", (err) =>
    console.log(`[pageerror] ${err.message.slice(0, 300)}`),
  );

  await page.goto("/probe.html");
  const input = page.locator("textarea").first();

  // 探针 1：接近 2MiB（未超上限）。
  await input.fill("gate00-finish-probe");
  await input.press("Enter");
  const nearMetrics = await readFinishMetrics(page, "probe", 2_070_000);
  console.log(
    `[gate00-finish] summary probe latencyMs=${Math.round(nearMetrics.latencyMs)} utf8Bytes=${nearMetrics.utf8Bytes}`,
  );

  // 探针 2：超过 2MiB（当前栈无服务端上限，记录实际行为；
  // 上限强制（413/断流）属于 S11 协议 v2 实现范围）。
  await input.fill("gate00-finish-overflow");
  await input.press("Enter");
  const overflowMetrics = await readFinishMetrics(page, "overflow", 2_310_000);
  console.log(
    `[gate00-finish] summary overflow latencyMs=${Math.round(overflowMetrics.latencyMs)} utf8Bytes=${overflowMetrics.utf8Bytes}`,
  );
});
