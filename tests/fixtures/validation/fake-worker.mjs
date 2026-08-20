#!/usr/bin/env node
/**
 * S9 Scheduler 集成测试的 worker 测试替身（不经 Chromium）。
 * 按 instructions.pageUrl 的 fake:// 协议模拟各类 worker 行为：
 * - fake://good            发出与 instructions 绑定的完整 completed 报告
 * - fake://fatal           completed 报告，含一条 fatal issue
 * - fake://sleep/<ms>      睡眠（触发 timeout）
 * - fake://spew            超 stdout 上限刷输出（触发 stdout_exceeded）
 * - fake://alloc/<mb>      常驻分配内存（触发 rss_killed；需小包络覆盖）
 * - fake://artifact/<mb>   写大文件到 VMA_VALIDATION_ARTIFACT_DIR
 * - fake://bad-digest      报告 digest 与计划不符
 * - fake://incomplete      报告 case 数少于计划
 * - fake://invalid-json    输出非 JSON
 * - fake://worker-failed   输出 status:failed 报告
 * - fake://crash           非零退出无报告
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const instructions = JSON.parse(readFileSync(process.argv[2], "utf8"));
const mode = instructions.pageUrl;

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => process.exit(0));
}

function goodReport(issues = []) {
  return {
    status: "completed",
    candidateDigest: instructions.candidateDigest,
    profileVersion: instructions.profileVersion,
    fatalVisualProfileVersion: instructions.fatalVisualProfileVersion,
    plannedCases: instructions.cases.length,
    cases: instructions.cases.map((workerCase) => ({
      route: workerCase.route,
      ...(workerCase.params ? { params: workerCase.params } : {}),
      viewport: workerCase.viewport,
      metrics: {
        horizontalOverflowPx: 0,
        mainWidthRatio: 0.8,
        verticalCollapseCount: 0,
        maxOverlapRatio: 0,
        maxClippedPx: 0,
        navMainGapPx: 0,
        maxBlankBandPx: 0,
      },
      issues,
    })),
  };
}

if (mode === "fake://good") {
  emit(goodReport());
} else if (mode === "fake://fatal") {
  emit(
    goodReport([
      {
        code: "viewport_overflow",
        severity: "fatal",
        gate: "G1-fatal",
        path: "/",
        message: "横向溢出 120px",
        route: instructions.cases[0]?.route ?? "/",
      },
    ]),
  );
} else if (mode.startsWith("fake://sleep/")) {
  const ms = Number(mode.slice("fake://sleep/".length));
  setTimeout(() => emit(goodReport()), ms);
} else if (mode === "fake://spew") {
  const chunk = "x".repeat(64 * 1024);
  for (let index = 0; index < 8; index += 1) process.stdout.write(chunk);
  emit(goodReport());
} else if (mode.startsWith("fake://alloc/")) {
  const mb = Number(mode.slice("fake://alloc/".length));
  const held = [];
  for (let index = 0; index < mb; index += 1) {
    held.push(Buffer.alloc(1024 * 1024, index % 251));
  }
  // 触摸页面防 GC；常驻等待父进程 RSS 轮询击杀
  const keepAlive = setInterval(() => {
    held[0][0] = Date.now() % 251;
  }, 500);
  setTimeout(() => {
    clearInterval(keepAlive);
    emit(goodReport());
  }, 60_000);
} else if (mode.startsWith("fake://artifact/")) {
  const mb = Number(mode.slice("fake://artifact/".length));
  const dir = process.env.VMA_VALIDATION_ARTIFACT_DIR;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "big.bin"), Buffer.alloc(mb * 1024 * 1024, 7));
  emit(goodReport());
} else if (mode === "fake://bad-digest") {
  emit({ ...goodReport(), candidateDigest: "tampered-digest" });
} else if (mode === "fake://incomplete") {
  const report = goodReport();
  report.cases = report.cases.slice(0, Math.max(0, report.cases.length - 1));
  emit(report);
} else if (mode === "fake://invalid-json") {
  process.stdout.write("this is not json\n", () => process.exit(0));
} else if (mode === "fake://worker-failed") {
  emit({
    status: "failed",
    code: "validation_render_failed",
    candidateDigest: instructions.candidateDigest,
    profileVersion: instructions.profileVersion,
    fatalVisualProfileVersion: instructions.fatalVisualProfileVersion,
    plannedCases: instructions.cases.length,
    cases: [],
  });
} else if (mode === "fake://crash") {
  process.stderr.write("simulated crash\n");
  process.exit(3);
} else {
  process.stderr.write(`unknown fake mode: ${mode}\n`);
  process.exit(64);
}
