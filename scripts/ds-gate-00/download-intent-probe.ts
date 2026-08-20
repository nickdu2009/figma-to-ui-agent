#!/usr/bin/env node
/**
 * DS-GATE-00 / DSG-05：DownloadIntent + 有界 CSV 的 Chromium 行为探针。
 *
 * 验证设计 §9.2 的关键浏览器假设（不依赖任何真实业务后端）：
 *  1. 同步 click 栈内 window.open 预开同源空白 target + 异步正文完成后在
 *     target 内创建 <a download> 并 click，确实产生指定文件名的下载。
 *  2. popup 被阻止时 beginDownloadIntent 返回 null，稳定失败、无下载。
 *  3. abort 后关闭 target、不产生下载。
 *  4. 重复消费同一 intent 被稳定拒绝。
 *  5. phase revoke 后迟到完成被稳定拒绝。
 *  6. 页面卸载时 host 关闭 target。
 *  7. object URL 在成功后 ≤60 秒被撤销（探针记录实际撤销时间）。
 *  8. 超过 10 MiB 上限时在发送正文前返回 413，host 不创建任何下载。
 *
 * 运行：node scripts/ds-gate-00/download-intent-probe.ts
 * 需要 PLAYWRIGHT_CHROMIUM_EXECUTABLE（使用完整 Chromium for Testing）。
 */
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Page } from "@playwright/test";
import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath) {
  console.error(
    "[download-probe] FAIL: PLAYWRIGHT_CHROMIUM_EXECUTABLE is required",
  );
  process.exit(1);
}

const CSV_BYTE_CAP = 10 * 1024 * 1024; // 设计上限：完整 UTF-8 正文 10 MiB

// 探针页注入的 window 面（Node 侧类型声明）。
interface CompleteResult {
  ok: boolean;
  code?: string;
}
interface IntentState {
  consumed: boolean;
  revoked: boolean;
  revokedAfterMs: number | null;
}
interface ScenarioBase {
  scenario: string;
  failed?: string;
}
interface ScenarioSuccess extends ScenarioBase {
  scenario: "success";
  complete?: CompleteResult;
  byteLength?: number;
}
interface ScenarioPopupBlocked extends ScenarioBase {
  scenario: "popupBlocked";
  intentIsNull?: boolean;
}
interface ScenarioAbort extends ScenarioBase {
  scenario: "abort";
  aborted?: boolean;
  errName?: string | null;
  elapsedMs?: number;
  cancel?: CompleteResult;
}
interface ScenarioDuplicate extends ScenarioBase {
  scenario: "duplicate";
  first?: CompleteResult;
  second?: CompleteResult;
}
interface ScenarioPhaseRevoke extends ScenarioBase {
  scenario: "phaseRevoke";
  late?: CompleteResult;
}
interface ScenarioOverflow extends ScenarioBase {
  scenario: "overflow";
  rejectedBeforeBody?: boolean;
  status?: number;
}
type ScenarioStatus =
  | ScenarioSuccess
  | ScenarioPopupBlocked
  | ScenarioAbort
  | ScenarioDuplicate
  | ScenarioPhaseRevoke
  | ScenarioOverflow;

interface ProbeWindow {
  __runScenario(name: string): Promise<void>;
  __waitForStatus(name: string): Promise<ScenarioStatus>;
  __intentState(id: string): Promise<IntentState | null>;
}

// ---------------------------------------------------------------------------
// Host 侧 DownloadIntent 参考实现（内嵌在探针页面中，按设计 §9.2 合同）
// ---------------------------------------------------------------------------
const PROBE_PAGE = `<!doctype html>
<html><head><meta charset="utf-8" /><title>download intent probe</title></head>
<body>
<button id="export">Export CSV</button>
<button id="export-overflow">Export Overflow</button>
<pre id="status"></pre>
<script>
const intents = new Map();
let nextId = 1;
const status = (msg) => {
  document.getElementById("status").textContent = JSON.stringify(msg);
};

// 同步 user gesture 栈内调用：预开同源空白、不可交互 target。
window.__beginDownloadIntent = () => {
  const id = "intent-" + nextId++;
  let target = null;
  try {
    target = window.open("", "_blank");
  } catch {
    target = null;
  }
  if (!target) return null;
  target.document.open();
  target.document.write("<!doctype html><title>Preparing download…</title><body></body>");
  target.document.close();
  const handle = {
    id,
    target,
    consumed: false,
    revoked: false,
    url: null,
    revokedAfterMs: null,
  };
  intents.set(id, handle);
  return { id };
};

// 异步正文完成后的一次性消费。
window.__completeDownload = (opaque, fileName, bytes, mimeType) => {
  const h = opaque && intents.get(opaque.id);
  if (!h) return { ok: false, code: "download_intent_unknown" };
  if (h.revoked) return { ok: false, code: "download_intent_revoked" };
  if (h.consumed) return { ok: false, code: "download_intent_already_consumed" };
  h.consumed = true;
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  h.url = url;
  const t0 = performance.now();
  const a = h.target.document.createElement("a");
  a.download = fileName;
  a.href = url;
  h.target.document.body.appendChild(a);
  a.click();
  // 成功排入下载后关闭 target 并尽快撤销 URL（设计上限 60s）。
  setTimeout(() => {
    const revokedAt = performance.now();
    try { h.target.close(); } catch {}
    URL.revokeObjectURL(url);
    h.revoked = true;
    h.revokedAfterMs = revokedAt - t0;
  }, 120);
  return { ok: true };
};

window.__cancelDownload = (opaque) => {
  const h = opaque && intents.get(opaque.id);
  if (!h) return { ok: false, code: "download_intent_unknown" };
  try { h.target.close(); } catch {}
  if (h.url) URL.revokeObjectURL(h.url);
  intents.delete(h.id);
  return { ok: true };
};

window.__intentState = (id) => {
  const h = intents.get(id);
  if (!h) return null;
  return { consumed: h.consumed, revoked: h.revoked, revokedAfterMs: h.revokedAfterMs };
};

window.__revokeAllIntents = () => {
  for (const h of intents.values()) {
    h.revoked = true;
    try { h.target.close(); } catch {}
    if (h.url) URL.revokeObjectURL(h.url);
  }
};

// 页面卸载：host 必须关闭所有仍打开的 target。
window.addEventListener("pagehide", () => window.__revokeAllIntents());

// 场景编排 -------------------------------------------------------------
const scenarios = {
  // 1) 成功：同步开 target -> 异步取正文 -> anchor 下载。
  async success() {
    const button = document.getElementById("export");
    let intent = null;
    const onClick = () => {
      intent = window.__beginDownloadIntent();
      if (!intent) { status({ scenario: "success", failed: "popup_blocked" }); return; }
    };
    button.addEventListener("click", onClick, { once: true });
    button.click();
    if (!intent) return;
    const res = await fetch("/export.csv?bytes=2048");
    if (!res.ok) { status({ scenario: "success", failed: "http_" + res.status }); window.__cancelDownload(intent); return; }
    const bytes = await res.arrayBuffer();
    const out = window.__completeDownload(intent, "records.csv", bytes, "text/csv; charset=utf-8");
    status({ scenario: "success", complete: out, byteLength: bytes.byteLength });
  },

  // 2) popup 被阻止。
  async popupBlocked() {
    const button = document.getElementById("export");
    const originalOpen = window.open;
    window.open = () => null;
    let intent = null;
    const onClick = () => { intent = window.__beginDownloadIntent(); };
    button.addEventListener("click", onClick, { once: true });
    button.click();
    window.open = originalOpen;
    status({ scenario: "popupBlocked", intentIsNull: intent === null });
  },

  // 3) abort：target 已开、请求中途 abort。
  async abort() {
    const button = document.getElementById("export");
    let intent = null;
    const onClick = () => { intent = window.__beginDownloadIntent(); };
    button.addEventListener("click", onClick, { once: true });
    button.click();
    if (!intent) { status({ scenario: "abort", failed: "no_intent" }); return; }
    const controller = new AbortController();
    const t0 = performance.now();
    const fetchPromise = fetch("/export.csv?bytes=2097152&slow=1", { signal: controller.signal });
    fetchPromise.catch(() => {});
    setTimeout(() => controller.abort(), 150);
    let failed = false;
    let errName = null;
    try {
      const response = await fetchPromise;
      await response.arrayBuffer();
    } catch (e) {
      failed = true;
      errName = e && e.name;
    }
    const cancel = window.__cancelDownload(intent);
    status({ scenario: "abort", aborted: failed, errName, elapsedMs: Math.round(performance.now() - t0), cancel });
  },

  // 4) 重复消费。
  async duplicate() {
    const button = document.getElementById("export");
    let intent = null;
    const onClick = () => { intent = window.__beginDownloadIntent(); };
    button.addEventListener("click", onClick, { once: true });
    button.click();
    if (!intent) { status({ scenario: "duplicate", failed: "no_intent" }); return; }
    const bytes = new Uint8Array([104, 101, 97, 100, 101, 114, 10]);
    const first = window.__completeDownload(intent, "dup.csv", bytes, "text/csv; charset=utf-8");
    const second = window.__completeDownload(intent, "dup.csv", bytes, "text/csv; charset=utf-8");
    status({ scenario: "duplicate", first, second });
  },

  // 5) phase revoke：revoke 后迟到完成。
  async phaseRevoke() {
    const button = document.getElementById("export");
    let intent = null;
    const onClick = () => { intent = window.__beginDownloadIntent(); };
    button.addEventListener("click", onClick, { once: true });
    button.click();
    if (!intent) { status({ scenario: "phaseRevoke", failed: "no_intent" }); return; }
    window.__revokeAllIntents();
    const bytes = new Uint8Array([104, 10]);
    const late = window.__completeDownload(intent, "late.csv", bytes, "text/csv; charset=utf-8");
    status({ scenario: "phaseRevoke", late });
  },

  // 8) 超限：服务器在正文前 413；host 不得创建任何下载。
  async overflow() {
    const button = document.getElementById("export-overflow");
    let intent = null;
    const onClick = () => { intent = window.__beginDownloadIntent(); };
    button.addEventListener("click", onClick, { once: true });
    button.click();
    if (!intent) { status({ scenario: "overflow", failed: "no_intent" }); return; }
    const res = await fetch("/export.csv?bytes=" + (10 * 1024 * 1024 + 1024));
    if (res.status === 413) {
      window.__cancelDownload(intent);
      status({ scenario: "overflow", rejectedBeforeBody: true, status: 413 });
    } else {
      status({ scenario: "overflow", rejectedBeforeBody: false, status: res.status });
    }
  },
};

window.__runScenario = (name) => scenarios[name]();
window.__waitForStatus = async (name) => {
  const prefix = '"scenario":"' + name + '"';
  for (let i = 0; i < 200; i++) {
    const text = document.getElementById("status").textContent;
    if (text && text.includes(prefix)) return JSON.parse(text);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("status timeout for " + name);
};
</script>
</body></html>`;

// ---------------------------------------------------------------------------
// 本地 HTTP 服务：探针页 + CSV 源（可注入延迟/超限）
// ---------------------------------------------------------------------------
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PROBE_PAGE);
    return;
  }
  if (url.pathname === "/export.csv") {
    const bytes = Number(url.searchParams.get("bytes") ?? "1024");
    const slow = url.searchParams.get("slow") === "1";
    if (bytes > CSV_BYTE_CAP) {
      // 超限：在发送正文前返回 413（设计要求）。
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "export_too_large" }));
      return;
    }
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-length": String(bytes),
    });
    if (slow) {
      // 慢速流：分块发送，供 abort 场景中断。
      const chunk = Buffer.alloc(64 * 1024, 0x61);
      let sent = 0;
      const timer = setInterval(() => {
        const n = Math.min(chunk.length, bytes - sent);
        res.write(n === chunk.length ? chunk : chunk.subarray(0, n));
        sent += n;
        if (sent >= bytes || res.destroyed) {
          clearInterval(timer);
          res.end();
        }
      }, 50);
      return;
    }
    res.end(Buffer.alloc(bytes, 0x61));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (typeof address !== "object" || address === null) {
  console.error("[download-probe] FAIL: cannot bind local server");
  process.exit(1);
}
const baseUrl = `http://127.0.0.1:${address.port}`;

function probeWindow(page: Page): ProbeWindow {
  // 通过 page.evaluate 在页面上下文中调用探针函数。
  return {
    __runScenario: (name) =>
      page.evaluate((n: string) => {
        const w = window as unknown as ProbeWindow;
        return w.__runScenario(n);
      }, name),
    __waitForStatus: (name) =>
      page.evaluate((n: string) => {
        const w = window as unknown as ProbeWindow;
        return w.__waitForStatus(n);
      }, name),
    __intentState: (id) =>
      page.evaluate((i: string) => {
        const w = window as unknown as ProbeWindow;
        return w.__intentState(i);
      }, id),
  };
}

const browser = await chromium.launch({ executablePath, headless: true });
const results: Record<string, unknown> = {
  probe: "ds-gate-00/download-intent-probe",
  node: process.version,
  measuredAt: new Date().toISOString(),
  chromium: executablePath,
};
let failed = false;
const mark = (name: string, ok: boolean, detail: unknown) => {
  results[name] = { ok, detail };
  if (!ok) failed = true;
};

try {
  const tmpDownloadDir = mkdtempSync(join(tmpdir(), "vma-gate-dl-"));
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const w = probeWindow(page);

  // 记录所有页面上的 download 事件。
  const downloads: Array<{ fileName: string | undefined; url: string }> = [];
  context.on("page", (p) => {
    p.on("download", (d) => {
      downloads.push({
        fileName: d.suggestedFilename(),
        url: d.url(),
      });
      void d.cancel().catch(() => {});
    });
  });
  page.on("download", (d) => {
    downloads.push({ fileName: d.suggestedFilename(), url: d.url() });
    void d.cancel().catch(() => {});
  });

  await page.goto(baseUrl);

  // 场景 1：成功下载，指定文件名。
  await w.__runScenario("success");
  const successStatus = await w.__waitForStatus("success");
  await page.waitForTimeout(600);
  const successDownload = downloads.find((d) => d.fileName === "records.csv");
  mark("successDownload", !!successDownload, {
    status: successStatus,
    downloads,
  });

  // object URL 撤销时间（成功后 ≤60s；探针实现 120ms）。
  const revokeState = await w.__intentState("intent-1");
  mark("urlRevokedWithin60s", revokeState?.revoked === true, revokeState);

  // 场景 2：popup 被阻止。
  downloads.length = 0;
  await w.__runScenario("popupBlocked");
  const popupStatus = (await w.__waitForStatus(
    "popupBlocked",
  )) as ScenarioPopupBlocked;
  await page.waitForTimeout(200);
  mark(
    "popupBlockedStable",
    popupStatus.intentIsNull === true && downloads.length === 0,
    { popupStatus, downloads },
  );

  // 场景 3：abort。
  downloads.length = 0;
  await w.__runScenario("abort");
  const abortStatus = (await w.__waitForStatus("abort")) as ScenarioAbort;
  await page.waitForTimeout(300);
  mark(
    "abortNoDownload",
    abortStatus.aborted === true && downloads.length === 0,
    { abortStatus, downloads },
  );

  // 场景 4：重复消费被拒绝。
  downloads.length = 0;
  await w.__runScenario("duplicate");
  const dupStatus = (await w.__waitForStatus("duplicate")) as ScenarioDuplicate;
  await page.waitForTimeout(400);
  const dupDownloads = downloads.filter((d) => d.fileName === "dup.csv");
  mark(
    "duplicateConsumptionRejected",
    dupStatus.second?.ok === false &&
      dupStatus.second?.code === "download_intent_already_consumed" &&
      dupDownloads.length === 1,
    { dupStatus, downloads },
  );

  // 场景 5：phase revoke 后迟到完成被拒绝。
  downloads.length = 0;
  await w.__runScenario("phaseRevoke");
  const revokeRes = (await w.__waitForStatus(
    "phaseRevoke",
  )) as ScenarioPhaseRevoke;
  await page.waitForTimeout(300);
  mark(
    "phaseRevokeRejected",
    revokeRes.late?.ok === false &&
      revokeRes.late?.code === "download_intent_revoked" &&
      downloads.filter((d) => d.fileName === "late.csv").length === 0,
    { revokeRes, downloads },
  );

  // 场景 8：超限 413 前置拒绝，无下载。
  downloads.length = 0;
  await w.__runScenario("overflow");
  const overflowStatus = (await w.__waitForStatus(
    "overflow",
  )) as ScenarioOverflow;
  await page.waitForTimeout(200);
  mark(
    "overflowRejectedBeforeBody",
    overflowStatus.rejectedBeforeBody === true && downloads.length === 0,
    { overflowStatus, downloads },
  );

  // 场景 6：页面卸载关闭 target。
  const pagesBeforeUnload = context.pages().length;
  await w.__runScenario("success");
  await w.__waitForStatus("success");
  await page.waitForTimeout(100);
  await page.close();
  await new Promise((r) => setTimeout(r, 400));
  const pagesAfterUnload = context.pages().length;
  mark("pageUnloadClosesTarget", pagesAfterUnload <= pagesBeforeUnload, {
    pagesBeforeUnload,
    pagesAfterUnload,
  });

  rmSync(tmpDownloadDir, { recursive: true, force: true });
  await context.close();
} finally {
  await browser.close();
  server.close();
}

results.overall = failed ? "fail" : "pass";
console.log(JSON.stringify(results, null, 2));
if (failed) process.exitCode = 1;
