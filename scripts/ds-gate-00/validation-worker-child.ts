#!/usr/bin/env node
/**
 * DS-GATE-00 / DSG-02+DSG-03：验证 worker 子进程。
 *
 * 受控模式（由 instructions JSON 决定）：
 *  - normal          ：按 case 清单访问 fixture 页面并采集 fatal 视觉指标，
 *                      最后向 stdout 输出一行有界 JSON 报告。
 *  - alloc-mem       ：分配并持有超过 RSS 预算的内存（测试父进程 kill 路径）。
 *  - spew-stdout     ：输出超过 stdout 预算的字节。
 *  - spew-stderr     ：输出超过 stderr 预算的字节。
 *  - big-report      ：输出超过 IPC 报告预算的 JSON（父进程必须拒绝）。
 *  - big-temp        ：向 tempDir 写入超过临时工件预算的文件。
 *  - exceed-requests ：在 ValidationSession 预算内模拟请求，验证超限稳定拒绝。
 *  - expired-session ：使用已过期 session，验证稳定拒绝。
 *  - slow            ：故意运行超过 jobTimeout（测试父进程 timeout kill）。
 *
 * 该脚本只用于 DS-GATE-00 校准；不访问网络、不读取任何凭据。
 */
import { writeFileSync, mkdirSync, readFileSync, truncateSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

interface WorkerCase {
  file: string;
  viewport: { width: number; height: number };
  label: string;
}

interface WorkerInstructions {
  mode: string;
  executablePath?: string;
  cases?: WorkerCase[];
  session?: {
    ttlSeconds: number;
    maxRequests: number;
    issuedAtMs: number;
  };
  budgets?: {
    tempDir?: string;
    tempBytes?: number;
    reportBytes?: number;
    stdoutBytes?: number;
  };
}

interface CaseMetrics {
  viewport: { width: number; height: number };
  horizontalOverflowPx: number;
  mainWidthRatio: number | null;
  verticalCollapseCount: number;
  maxOverlapRatio: number;
  maxClippedPx: number;
  navMainGapPx: number | null;
  maxBlankBandPx: number;
}

function emitLine(payload: object): void {
  // 必须在写回调中退出，否则 process.exit 可能截断待写 stdout。
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => process.exit(0));
  process.exitCode = 0;
}

function fail(code: string): never {
  emitLine({ status: "failed", code, cases: [] });
  throw new Error("unreachable");
}

const instructionsPath = process.argv[2];
if (!instructionsPath) {
  console.error("usage: validation-worker-child.ts <instructions.json>");
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

// ---------------------------------------------------------------------------
// ValidationSession 预算自检（DSG-02：TTL 与请求数）
// ---------------------------------------------------------------------------
if (instructions.session) {
  const { ttlSeconds, maxRequests, issuedAtMs } = instructions.session;
  if (Date.now() - issuedAtMs > ttlSeconds * 1000) {
    fail("validation_session_expired");
  }
  if (instructions.mode === "exceed-requests") {
    let used = 0;
    for (let i = 0; i < maxRequests + 5; i++) {
      if (used >= maxRequests) {
        fail("validation_session_request_limit_exceeded");
      }
      used++;
    }
  }
}

// ---------------------------------------------------------------------------
// 故障注入模式（if/else 链，每支自行退出）
// ---------------------------------------------------------------------------
if (instructions.mode === "expired-session") {
  fail("validation_session_expired");
} else if (instructions.mode === "spew-stdout") {
  const budget = instructions.budgets?.stdoutBytes ?? 65_536;
  const chunk = "x".repeat(8192);
  let emitted = 0;
  while (emitted <= budget) {
    process.stdout.write(`${chunk}\n`);
    emitted += chunk.length + 1;
  }
  fail("validation_output_limit_exceeded");
} else if (instructions.mode === "spew-stderr") {
  const budget = instructions.budgets?.stdoutBytes ?? 65_536;
  const chunk = "x".repeat(8192);
  let emitted = 0;
  while (emitted <= budget) {
    process.stderr.write(`${chunk}\n`);
    emitted += chunk.length + 1;
  }
  fail("validation_output_limit_exceeded");
} else if (instructions.mode === "big-report") {
  const budget = instructions.budgets?.reportBytes ?? 1_048_576;
  const padding = "p".repeat(budget + 1024);
  emitLine({ status: "completed", padding, cases: [] });
} else if (instructions.mode === "big-temp") {
  const dir = instructions.budgets?.tempDir ?? ".";
  const budget = instructions.budgets?.tempBytes ?? 8_388_608;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "oversized.bin");
  writeFileSync(file, "");
  // 用逻辑长度校验配额，避免 Gate 探针无谓占用 256MiB 内存。
  truncateSync(file, budget + 4096);
  emitLine({ status: "completed", cases: [] });
} else if (instructions.mode === "alloc-mem") {
  const blocks: Buffer[] = [];
  // 分配并持有 ~768 MiB，模拟 worker RSS 超预算。
  for (let i = 0; i < 96; i++) {
    blocks.push(Buffer.alloc(8 * 1024 * 1024, 1));
  }
  // 写一次以触及物理页。
  let acc = 0;
  for (const block of blocks) acc += block[0]!;
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  emitLine({ status: "completed", acc, cases: [] });
} else if (instructions.mode === "slow") {
  await new Promise((resolve) => setTimeout(resolve, 120_000));
  emitLine({ status: "completed", cases: [] });
} else {
  // normal：fatal 视觉指标采集（DSG-03 校准）。
  // 注意：Playwright 1.61 的字符串 evaluate 返回 undefined，必须传真实
  // 函数；该函数必须自包含（不引用任何模块作用域变量）。
  const collectFatalMetrics = (): CaseMetrics => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollWidth = document.scrollingElement
      ? document.scrollingElement.scrollWidth
      : document.documentElement.scrollWidth;
    const root = document.querySelector('[data-role="root"]') ?? document.body;

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

    const nav = document.querySelector('[data-role="nav"]');
    const main = document.querySelector('[data-role="main"]');
    const navRect = nav ? rectOf(nav) : null;
    const mainRect = main ? rectOf(main) : null;

    // 主内容宽度占比
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

    // 关键元素重叠：交集面积 / 较小者面积
    const criticals = [...document.querySelectorAll('[data-role="critical"]')]
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

    // 连续空白带：root 范围内每 16px 一条水平带，在 25%/50%/75% 宽度三个
    // 采样点均只命中 root/body/html 视为空白；只统计首尾内容带之间。
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
      viewport: { width: vw, height: vh },
      horizontalOverflowPx: scrollWidth - vw,
      mainWidthRatio,
      verticalCollapseCount,
      maxOverlapRatio: Number(maxOverlapRatio.toFixed(4)),
      maxClippedPx,
      navMainGapPx,
      maxBlankBandPx,
    };
  };

  const browser = await chromium.launch({
    executablePath: instructions.executablePath,
    headless: true,
  });
  const cases: Array<{ label: string; metrics: CaseMetrics }> = [];
  try {
    for (const workerCase of instructions.cases ?? []) {
      const context = await browser.newContext({
        viewport: workerCase.viewport,
      });
      const page = await context.newPage();
      await page.goto(`file://${workerCase.file}`, {
        waitUntil: "load",
      });
      await page.waitForTimeout(50);
      const metrics = await page.evaluate(collectFatalMetrics);
      cases.push({ label: workerCase.label, metrics });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  emitLine({ status: "completed", cases });
}
