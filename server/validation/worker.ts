#!/usr/bin/env node
/**
 * Validation worker 子进程（设计 §11.5，计划 S9 动作 4–5）。
 *
 * 由 ValidationScheduler 以 instructions JSON 启动（argv[2]）：
 * 1. 以 Authorization: Bearer <capability> 获取只读 bootstrap
 *    （Candidate Bundle + businessSchema + asset 基址/allowlist）；
 * 2. 启动独立 Chromium（不与任何进程共享 Browser/页面/可变内存）；
 * 3. 逐 case（路由×视口）：addInitScript 注入 bootstrap（capability 不进入
 *    页面）→ page.route 拦截资产请求经 worker 代取 → 打开 __validation
 *    页面 → 等待渲染就绪标记 → 采集 fatal 视觉指标；
 * 4. 按批准阈值判定 fatal issue（G1-fatal），stdout 输出单行有界报告。
 *
 * 只读：不修改 Candidate、不产生部分报告、不保存截图/业务正文。
 * 任何基础设施异常以 {status:"failed", code} 单行退出。
 */
import { readFileSync, writeSync } from "node:fs";
import process from "node:process";
import { chromium } from "@playwright/test";
import {
  workerReportSchema,
  type CaseMetrics,
  type ValidationCaseResult,
  type ValidationIssue,
  type WorkerInstructions,
} from "./worker-protocol.ts";

function emitLine(payload: object): never {
  // 同步写 stdout（writeSync 阻塞至落盘）后直接退出：不回调竞态、不抛
  // “终止控制流”异常（否则会被 main().catch 二次捕获并覆盖报告）。
  writeSync(1, `${JSON.stringify(payload)}\n`);
  process.exit(0);
}

function fail(code: string, detail?: string): never {
  emitLine({
    status: "failed",
    code,
    ...(detail ? { detail: detail.slice(0, 200) } : {}),
    candidateDigest: "unknown",
    profileVersion: "unknown",
    fatalVisualProfileVersion: "unknown",
    plannedCases: 0,
    cases: [],
  });
}

const instructionsPath = process.argv[2];
if (!instructionsPath) {
  process.stderr.write("usage: validation-worker.ts <instructions.json>\n");
  process.exit(2);
}
let instructions: WorkerInstructions;
try {
  instructions = JSON.parse(
    readFileSync(instructionsPath, "utf8"),
  ) as WorkerInstructions;
} catch {
  fail("validation_worker_instructions_invalid");
}

interface ValidationBootstrap {
  bundle: unknown;
  businessSchema: unknown;
  candidateDigest: string;
  assetBaseUrl: string;
  assetAllowlist: string[];
}

/**
 * SSRF 纵深防御：worker 只允许访问 loopback/.localhost 主机。
 * instructions 由父进程写入（非用户输入），但 worker 仍独立核验。
 */
function assertAllowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("validation_worker_url_forbidden");
  }
  const host = url.hostname;
  const allowed =
    (url.protocol === "http:" || url.protocol === "https:") &&
    (host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".localhost"));
  if (!allowed) fail("validation_worker_url_forbidden");
  return url;
}

async function fetchBootstrap(): Promise<ValidationBootstrap> {
  assertAllowedUrl(instructions.bootstrapUrl);
  const response = await fetch(instructions.bootstrapUrl, {
    headers: { authorization: `Bearer ${instructions.capability}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    fail(`validation_bootstrap_http_${response.status}`);
  }
  const body = (await response.json()) as ValidationBootstrap;
  if (body.candidateDigest !== instructions.candidateDigest) {
    fail("validation_bootstrap_digest_mismatch");
  }
  return body;
}

/** 阈值判定（worker 内完成；与 fatal-visual-v1 夹具规则一致）。 */
function evaluateFatalIssues(
  metrics: CaseMetrics,
  route: string,
): ValidationIssue[] {
  const t = instructions.thresholds;
  const issues: ValidationIssue[] = [];
  const push = (code: string, message: string) =>
    issues.push({
      code,
      severity: "fatal",
      gate: "G1-fatal",
      path: "/",
      message,
      route,
    });
  if (
    metrics.mainWidthRatio !== null &&
    metrics.mainWidthRatio < t.contentWidthMinRatio
  ) {
    push(
      "content_width_too_narrow",
      `主内容宽度占比 ${metrics.mainWidthRatio}`,
    );
  }
  if (metrics.verticalCollapseCount >= t.verticalCollapseMinCount) {
    push(
      "vertical_text_collapse",
      `纵排塌陷文本块 ${metrics.verticalCollapseCount} 个`,
    );
  }
  if (metrics.maxOverlapRatio > t.overlapMinRatio) {
    push("critical_overlap", `关键元素重叠比 ${metrics.maxOverlapRatio}`);
  }
  if (metrics.horizontalOverflowPx > t.overflowMaxPx) {
    push("viewport_overflow", `横向溢出 ${metrics.horizontalOverflowPx}px`);
  }
  if (metrics.maxClippedPx > t.clippedMinPx) {
    push("content_clipped", `内容裁切 ${metrics.maxClippedPx}px`);
  }
  if (metrics.navMainGapPx !== null && metrics.navMainGapPx > t.navGapMaxPx) {
    push(
      "navigation_content_detached",
      `导航与正文断裂 ${metrics.navMainGapPx}px`,
    );
  }
  if (metrics.maxBlankBandPx > t.blankBandMaxPx) {
    push("excessive_blank_region", `连续空白带 ${metrics.maxBlankBandPx}px`);
  }
  return issues;
}

/**
 * fatal 视觉指标采集器（page.evaluate 用；必须自包含，不引用模块作用域）。
 * 选择器：语义元素优先（main/nav），兼容 data-role 标记；critical =
 * main 内交互元素（有界 64 个）。
 */
const collectFatalMetrics = (): CaseMetrics => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scrollWidth = document.scrollingElement
    ? document.scrollingElement.scrollWidth
    : document.documentElement.scrollWidth;
  const root =
    document.querySelector("[data-vma-validation-root]") ??
    document.querySelector('[data-role="root"]') ??
    document.body;

  const rectOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  };

  const nav =
    document.querySelector("nav") ??
    document.querySelector('[data-role="nav"]');
  const main =
    document.querySelector("main") ??
    document.querySelector('[data-role="main"]');
  const navRect = nav ? rectOf(nav) : null;
  const mainRect = main ? rectOf(main) : null;

  const mainWidthRatio = mainRect ? mainRect.width / vw : null;

  // 纵排塌陷：正文文本块（>=30 字符）宽 < 24px 且高 > 200px
  let verticalCollapseCount = 0;
  if (main) {
    for (const el of main.querySelectorAll("p,div,h1,h2,h3,span")) {
      const text = (el.textContent ?? "").trim();
      if (text.length < 30) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 24 && r.height > 200) verticalCollapseCount++;
    }
  }

  // 关键元素重叠：main 内交互元素（有界），交集面积 / 较小者面积
  const criticals = [
    ...((main ?? root).querySelectorAll(
      'a,button,input,select,textarea,[role="button"],[role="link"],[data-role="critical"]',
    ) as NodeListOf<Element>),
  ]
    .slice(0, 64)
    .map((el) => ({ el, rect: rectOf(el) }))
    .filter((c) => c.rect.width > 0 && c.rect.height > 0);
  let maxOverlapRatio = 0;
  for (let i = 0; i < criticals.length; i++) {
    for (let j = i + 1; j < criticals.length; j++) {
      const a = criticals[i]!.rect;
      const b = criticals[j]!.rect;
      const ix = Math.max(
        0,
        Math.min(a.right, b.right) - Math.max(a.left, b.left),
      );
      const iy = Math.max(
        0,
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
      );
      const inter = ix * iy;
      const minArea = Math.min(a.width * a.height, b.width * b.height);
      if (minArea > 0)
        maxOverlapRatio = Math.max(maxOverlapRatio, inter / minArea);
    }
  }

  // 关键内容被裁切：overflow hidden 且 scrollHeight 显著大于 clientHeight
  let maxClippedPx = 0;
  const clipCandidates: Element[] = criticals.map((c) => c.el);
  if (main) clipCandidates.push(main);
  for (const el of clipCandidates) {
    const style = window.getComputedStyle(el);
    if (style.overflowY !== "hidden" && style.overflow !== "hidden") continue;
    const clipped = el.scrollHeight - el.clientHeight;
    if (clipped > maxClippedPx) maxClippedPx = clipped;
  }

  // 导航与正文断裂：main.top - nav.bottom
  let navMainGapPx: number | null = null;
  if (navRect && mainRect) navMainGapPx = mainRect.top - navRect.bottom;

  // 连续空白带：root 范围内每 16px 一条水平带，25%/50%/75% 宽度采样点
  // 均只命中 root/body/html 视为空白；只统计首尾内容带之间。
  const rootRect = rectOf(root);
  const blankAt = (y: number) => {
    const xs = [0.25, 0.5, 0.75];
    for (const fx of xs) {
      const x = rootRect.left + rootRect.width * fx;
      const els = document.elementsFromPoint(x, y);
      const hit = els.find(
        (el) =>
          !(
            el === root ||
            el === document.body ||
            el === document.documentElement
          ),
      );
      if (hit) {
        const style = window.getComputedStyle(hit);
        const hasContent =
          (hit.textContent ?? "").trim().length > 0 ||
          style.backgroundColor !== "rgba(0, 0, 0, 0)" ||
          style.borderTopWidth !== "0px";
        if (hasContent) return false;
      }
    }
    return true;
  };
  let maxBlankBandPx = 0;
  let run = 0;
  const startY = Math.max(rootRect.top, 0);
  const endY = Math.min(rootRect.bottom, vh * 3);
  let firstContentY: number | null = null;
  let lastContentY: number | null = null;
  for (let y = startY; y < endY; y += 16) {
    if (!blankAt(y)) {
      if (firstContentY === null) firstContentY = y;
      lastContentY = y;
    }
  }
  if (firstContentY !== null && lastContentY !== null) {
    for (let y = firstContentY; y <= lastContentY; y += 16) {
      if (blankAt(y)) {
        run += 16;
        maxBlankBandPx = Math.max(maxBlankBandPx, run);
      } else {
        run = 0;
      }
    }
  }

  return {
    horizontalOverflowPx: scrollWidth - vw,
    mainWidthRatio,
    verticalCollapseCount,
    maxOverlapRatio: Number(maxOverlapRatio.toFixed(4)),
    maxClippedPx,
    navMainGapPx,
    maxBlankBandPx,
  };
};

async function main(): Promise<never> {
  const bootstrap = await fetchBootstrap();
  const allowlist = new Set(bootstrap.assetAllowlist);
  const assetBase = bootstrap.assetBaseUrl.endsWith("/")
    ? bootstrap.assetBaseUrl
    : `${bootstrap.assetBaseUrl}/`;

  const browser = await chromium.launch({
    executablePath: instructions.executablePath,
    headless: true,
  });
  const cases: ValidationCaseResult[] = [];
  try {
    for (const workerCase of instructions.cases) {
      const context = await browser.newContext({
        viewport: {
          width: workerCase.viewport.width,
          height: workerCase.viewport.height,
        },
        // Profile 固定：DPR/locale/reduced-motion 写入报告语义（P0 默认态）
        locale: "zh-CN",
        reducedMotion: "reduce",
      });
      try {
        // 资产代取：页面请求 /__validation-asset/<assetId>，worker 核对
        // allowlist 后携 capability 代取（capability 不进入页面）。
        await context.route("**/__validation-asset/*", async (route) => {
          const url = new URL(route.request().url());
          const assetId = decodeURIComponent(
            url.pathname.slice("/__validation-asset/".length),
          );
          if (!allowlist.has(assetId)) {
            await route.fulfill({ status: 404, body: "asset not allowed" });
            return;
          }
          try {
            assertAllowedUrl(`${assetBase}${encodeURIComponent(assetId)}`);
            const upstream = await fetch(
              `${assetBase}${encodeURIComponent(assetId)}`,
              {
                headers: { authorization: `Bearer ${instructions.capability}` },
              },
            );
            if (!upstream.ok) {
              await route.fulfill({ status: upstream.status });
              return;
            }
            const bytes = Buffer.from(await upstream.arrayBuffer());
            await route.fulfill({
              status: 200,
              body: bytes,
              headers: {
                "content-type":
                  upstream.headers.get("content-type") ??
                  "application/octet-stream",
              },
            });
          } catch {
            await route.fulfill({ status: 502, body: "asset fetch failed" });
          }
        });
        const page = await context.newPage();
        const bootstrapPayload = {
          bundle: bootstrap.bundle,
          businessSchema: bootstrap.businessSchema,
          route: workerCase.route,
          params: workerCase.params ?? null,
        };
        await page.addInitScript((payload) => {
          (
            window as unknown as Record<string, unknown>
          ).__VALIDATION_BOOTSTRAP__ = payload;
        }, bootstrapPayload);
        await page.goto(instructions.pageUrl, { waitUntil: "load" });
        // 渲染就绪标记（validation-app 首次提交后设置；failed:* 快速失败）
        await page.waitForFunction(
          () => {
            const flag = (window as unknown as Record<string, unknown>)
              .__VALIDATION_RENDERED__;
            return (
              flag === "done" ||
              flag === "empty" ||
              (typeof flag === "string" && flag.startsWith("failed:"))
            );
          },
          undefined,
          { timeout: instructions.renderTimeoutMs },
        );
        const renderFlag = await page.evaluate(
          () =>
            (window as unknown as Record<string, unknown>)
              .__VALIDATION_RENDERED__ as string | undefined,
        );
        if (
          typeof renderFlag === "string" &&
          renderFlag.startsWith("failed:")
        ) {
          // 任一路由无法加载 → 整个 job 失败（设计 §11.5；不产生部分报告）
          fail("validation_render_failed", renderFlag);
        }
        await page.waitForTimeout(50);
        const metrics = await page.evaluate(collectFatalMetrics);
        cases.push({
          route: workerCase.route,
          ...(workerCase.params ? { params: workerCase.params } : {}),
          viewport: workerCase.viewport,
          metrics,
          issues: evaluateFatalIssues(metrics, workerCase.route),
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    status: "completed" as const,
    candidateDigest: instructions.candidateDigest,
    profileVersion: instructions.profileVersion,
    fatalVisualProfileVersion: instructions.fatalVisualProfileVersion,
    plannedCases: instructions.cases.length,
    cases,
  };
  // 自检：报告必须通过协议 schema（否则父进程按 report_invalid 拒绝）
  const validated = workerReportSchema.safeParse(report);
  if (!validated.success) {
    fail("validation_worker_report_invalid");
  }
  emitLine(report);
}

main().catch((error: unknown) => {
  // 基础设施异常：有界失败报告（code 稳定；detail 有界、不含堆栈/凭据）
  const name = error instanceof Error ? error.name : "unknown";
  const detail = error instanceof Error ? error.message : String(error);
  fail(`validation_worker_${name}`.slice(0, 64), detail);
});
