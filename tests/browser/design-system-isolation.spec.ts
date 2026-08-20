import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { adminEmailFor, loginCreateAndEnter } from "./e2e-helpers.ts";
import { appUiBundleSchema } from "../../src/catalog/app-ui-bundle.js";
import { digestCanonicalJson } from "../../src/catalog/canonical-json.js";

/**
 * S6 浏览器验收（Mock，不调 LLM）：Token/CSS 编译与 Preview containment。
 * - 两个 Bundle 顺序切换：designCss 原子替换（同一时刻仅一个 style 元素），
 *   作用域 revision 递增，A 的样式在 B 提交后不再命中；
 * - 宿主聊天页/app-shell 在任何提交前后样式不变（computed style 快照对比）；
 * - 恶意夹具（宿主选择器 / position:fixed 宿主级 overlay）fail closed：
 *   候选拒绝，旧 Preview 与旧 style 元素保留；
 * - Preview root 启用 containment（layout paint style）与独立 stacking context。
 * 夹具：tests/fixtures/bundles/css-escape/*。
 */

const FIXTURE_DIR = "tests/fixtures/bundles/css-escape";

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(`${FIXTURE_DIR}/${name}.json`, "utf8"),
  ) as unknown;
}

/**
 * Node 侧解析 schema 与 digest（Playwright 进程可导入项目模块），浏览器
 * evaluate 只调 __previewController.stageBundle（bundle 经结构化克隆传递）。
 */
async function stageFixture(
  page: Page,
  name: string,
  generationId: string,
): Promise<{ status: string; code?: string }> {
  const raw = await loadFixture(name);
  const bundle = appUiBundleSchema.parse(raw);
  const [candidateDigest, uiBundleDigest] = await Promise.all([
    digestCanonicalJson({ v2: bundle }),
    digestCanonicalJson(bundle),
  ]);
  return page.evaluate(
    async ({ bundleObject, candidate, uiBundle, gen }) => {
      const controller = (
        window as unknown as {
          __previewController: {
            stageBundle: (input: unknown) => Promise<{ status: string; code?: string }>;
          };
        }
      ).__previewController;
      if (!controller) throw new Error("__previewController missing");
      return controller.stageBundle({
        generationId: gen,
        bundle: bundleObject,
        expected: { candidateDigest: candidate, uiBundleDigest: uiBundle },
      });
    },
    {
      bundleObject: bundle,
      candidate: candidateDigest,
      uiBundle: uiBundleDigest,
      gen: generationId,
    },
  );
}

interface HostStyleSnapshot {
  chatBorderLeft: string;
  shellBorderLeft: string;
  bodyBackground: string;
}

async function hostSnapshot(page: Page): Promise<HostStyleSnapshot> {
  return page.evaluate(() => {
    const chat = document.querySelector<HTMLElement>('[data-testid="chat-panel"]');
    const shell = document.querySelector<HTMLElement>('[data-testid="app-shell"]');
    return {
      chatBorderLeft: chat ? getComputedStyle(chat).borderLeftWidth : "missing",
      shellBorderLeft: shell ? getComputedStyle(shell).borderLeftWidth : "missing",
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    };
  });
}

test("design system isolation: sequential bundles swap atomically, host unaffected", async ({
  page,
}) => {
  await loginCreateAndEnter(
    page,
    adminEmailFor(test.info().workerIndex),
    "ds-iso-app-1",
  );

  const before = await hostSnapshot(page);
  const surface = page.locator(".preview-surface");
  await expect(surface).toBeVisible();

  // 初始：无应用 CSS（无 style 元素、无 root 标记属性）。
  await expect(surface.locator("> style[data-vma-design-css]")).toHaveCount(0);
  await expect(surface).not.toHaveAttribute("data-vma-preview-root");

  // ---- Bundle A（蓝）----
  const resultA = await stageFixture(page, "benign-a", "gen_ds_a");
  expect(resultA.status).toBe("committed");

  await expect(surface).toHaveAttribute("data-bundle-revision", "1");
  await expect(
    surface.locator("> style[data-vma-design-css]"),
  ).toHaveCount(1);
  const styleA = await surface.locator("> style[data-vma-design-css]").textContent();
  expect(styleA).toContain('[data-vma-preview-root][data-bundle-revision="1"] .ds-marker');
  expect(styleA).toContain("--vma-pt-color-primary: #1a73e8;");

  const marker = surface.locator(".ds-marker").first();
  await expect(marker).toBeVisible();
  await expect(marker).toHaveCSS("border-left-width", "7px");
  await expect(marker).toHaveCSS("border-left-style", "solid");
  await expect(marker).toHaveCSS("border-left-color", "rgb(26, 115, 232)");

  // containment root（宿主样式表注入，非应用 CSS）。Chromium 把
  // “layout paint style” 折叠序列化为 "content"（style 无独立序列化），
  // 因此按语义断言：layout+paint 必须在场，而不是逐字匹配。
  const containment = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".preview-surface");
    const style = el ? getComputedStyle(el) : null;
    return {
      contain: style?.contain ?? "missing",
      isolation: style?.isolation ?? "missing",
      position: style?.position ?? "missing",
    };
  });
  expect(containment.isolation).toBe("isolate");
  expect(containment.position).toBe("relative");
  const tokens = containment.contain.trim().split(/\s+/);
  const hasLayoutPaint =
    containment.contain === "content" ||
    (tokens.includes("layout") && tokens.includes("paint"));
  expect(hasLayoutPaint).toBe(true);

  // 宿主不变。
  expect(await hostSnapshot(page)).toEqual(before);

  // ---- Bundle B（绿）：原子替换 ----
  const resultB = await stageFixture(page, "benign-b", "gen_ds_b");
  expect(resultB.status).toBe("committed");

  await expect(surface).toHaveAttribute("data-bundle-revision", "2");
  await expect(
    surface.locator("> style[data-vma-design-css]"),
  ).toHaveCount(1);
  const styleB = await surface.locator("> style[data-vma-design-css]").textContent();
  expect(styleB).toContain("--vma-pt-color-primary: #0f9d58;");
  expect(styleB).not.toContain("#1a73e8");
  expect(styleB).toContain('[data-bundle-revision="2"] .ds-marker');

  await expect(marker).toHaveCSS("border-left-width", "3px");
  await expect(marker).toHaveCSS("border-left-style", "dotted");
  await expect(marker).toHaveCSS("border-left-color", "rgb(15, 157, 88)");

  expect(await hostSnapshot(page)).toEqual(before);
});

test("design system isolation: malicious fixtures fail closed, old preview stays", async ({
  page,
}) => {
  await loginCreateAndEnter(
    page,
    adminEmailFor(test.info().workerIndex),
    "ds-iso-app-2",
  );

  const before = await hostSnapshot(page);
  const surface = page.locator(".preview-surface");
  await expect(surface).toBeVisible();

  // 基线：Bundle B 先提交。
  expect((await stageFixture(page, "benign-b", "gen_ds_base")).status).toBe("committed");
  await expect(surface.locator(".ds-marker").first()).toHaveCSS(
    "border-left-width",
    "3px",
  );

  // 恶意：宿主选择器。
  const hostResult = await stageFixture(page, "malicious-host", "gen_ds_host");
  expect(hostResult).toMatchObject({ status: "failed", code: "css_host_selector" });
  await expect(surface.locator(".ds-marker").first()).toHaveCSS(
    "border-left-width",
    "3px",
  );
  await expect(surface).toHaveAttribute("data-bundle-revision", "1");
  await expect(
    surface.locator("> style[data-vma-design-css]"),
  ).toHaveCount(1);

  // 恶意：宿主级 fixed overlay。
  const fixedResult = await stageFixture(page, "malicious-fixed", "gen_ds_fixed");
  expect(fixedResult).toMatchObject({ status: "failed", code: "css_value_forbidden" });

  // 宿主样式在两次恶意尝试后仍不变。
  expect(await hostSnapshot(page)).toEqual(before);
});
