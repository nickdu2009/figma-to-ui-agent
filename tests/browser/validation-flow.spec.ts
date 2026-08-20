/**
 * S9 浏览器验收：P0 Validation 全链路（mock 模式，不调 LLM）。
 * 真实 ValidationScheduler + 真实 worker 子进程 + Chromium + __validation
 * 页面 + capability 端点 + MySQL 状态机：
 * - 正常 Candidate：validation_running → awaiting_preview，报告/digest/
 *   profileVersion 落库，case 完整（路由×两视口）；
 * - fatal 溢出 Candidate：→ recovery_pending，fatalVisualIssues 含
 *   viewport_overflow；
 * - capability 面：无令牌/伪造令牌访问 bootstrap → 403 稳定 code；
 *   未登录触发 → 401。
 * 对应 AC11f/AC11g/AC11h/AC11i/AC13a。
 */
import { expect, test } from "@playwright/test";
import mysql from "mysql2/promise";
import { adminEmailFor, createAppViaApi, uiLogin } from "./e2e-helpers.ts";

const ORIGIN = { Origin: "http://127.0.0.1:3100" };
const DEV_DB =
  process.env.VMA_DATABASE_URL ??
  "mysql://vma:vma-local-dev-only@127.0.0.1:3317/vite_multipage_agent";

const NORMAL_BUNDLE = {
  bundleVersion: 1,
  catalogVersion: "1.0.0",
  specCompatibility: "0.19.0",
  spec: {
    metadata: { title: { default: "验证目标", template: "%s" } },
    routes: {
      "/": {
        page: {
          root: "root",
          elements: {
            root: {
              type: "Stack",
              props: {
                direction: "vertical",
                gap: "md",
                align: null,
                justify: null,
                className: null,
              },
              children: ["title"],
            },
            title: {
              type: "Heading",
              props: { text: "验证目标应用", level: "h1", className: null },
              children: [],
            },
          },
        },
      },
    },
    state: { ui: { detail: { open: false } } },
  },
  designSystem: {
    tokens: {
      primitive: {
        "color.primary": { type: "color", value: "#1a73e8" },
        "space.md": { type: "length", value: 16, unit: "px" },
      },
      semantic: { "color.surface": { $token: "color.primary" } },
      component: {},
    },
    applicationCss: "",
  },
  assets: { entries: [] },
};

/** fatal 变体：applicationCss 强制 5000px 宽 → viewport_overflow。 */
const FATAL_BUNDLE = {
  ...NORMAL_BUNDLE,
  spec: {
    metadata: { title: { default: "fatal 目标", template: "%s" } },
    routes: {
      "/": {
        page: {
          root: "root",
          elements: {
            root: {
              type: "Stack",
              props: {
                direction: "vertical",
                gap: "md",
                align: null,
                justify: null,
                className: "vma-wide",
              },
              children: ["title"],
            },
            title: {
              type: "Heading",
              props: { text: "fatal 验证目标", level: "h1", className: null },
              children: [],
            },
          },
        },
      },
    },
    state: { ui: {} },
  },
  designSystem: {
    ...NORMAL_BUNDLE.designSystem,
    applicationCss: ".vma-wide { min-width: 5000px; }",
  },
};

test("S9 validation-flow：真实 worker 全链路（正常 + fatal + capability 面）", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await uiLogin(page, adminEmailFor(test.info().workerIndex));
  const appId = await createAppViaApi(
    page,
    `s9-validation-${test.info().workerIndex}-${Date.now()}`,
  );
  const pool = mysql.createPool(DEV_DB);
  const seededRuns: string[] = [];

  const seedRun = async (bundle: unknown, digest: string): Promise<string> => {
    const runId = crypto.randomUUID();
    await pool.execute(
      "INSERT INTO `generation_runs` (`id`, `app_id`, `status`, `candidate_digest`, `candidate_bundle`, `created_at`, `updated_at`) VALUES (?, ?, 'validation_running', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [runId, appId, digest, JSON.stringify(bundle)],
    );
    seededRuns.push(runId);
    return runId;
  };

  try {
    // ---------- 1. 正常 Candidate → awaiting_preview ----------
    const normalRunId = await seedRun(NORMAL_BUNDLE, "cd-e2e-normal");
    const triggered = await page.request.post(
      `/api/mock/validation/${normalRunId}/run`,
      { headers: ORIGIN },
    );
    expect(triggered.status()).toBe(200);
    const outcome = (await triggered.json()) as {
      status: string;
      reportDigest?: string;
      publishBlocked?: boolean;
    };
    if (outcome.status !== "awaiting_preview") {
      // 失败诊断：转储 run diagnostics（断言失败时可见）
      const [debugRows] = await pool.execute(
        "SELECT `status`, `diagnostics` FROM `generation_runs` WHERE `id` = ?",
        [normalRunId],
      );
      console.log(
        "validation-flow 失败诊断：",
        JSON.stringify((debugRows as Array<Record<string, unknown>>)[0]),
      );
    }
    expect(outcome.status).toBe("awaiting_preview");
    expect(outcome.reportDigest).toBeTruthy();
    expect(outcome.publishBlocked).toBe(false);

    const [normalRows] = await pool.execute(
      "SELECT `status`, `report_digest`, `validation_profile_version`, `validation_report` FROM `generation_runs` WHERE `id` = ?",
      [normalRunId],
    );
    const normalRow = (normalRows as Array<Record<string, unknown>>)[0]!;
    expect(normalRow.status).toBe("awaiting_preview");
    expect(normalRow.report_digest).toBe(outcome.reportDigest);
    expect(normalRow.validation_profile_version).toBe("p0-validation-v1");
    const report = normalRow.validation_report as {
      plannedCases: number;
      completedCases: number;
      cases: Array<{
        route: string;
        viewport: { label: string };
        metrics: { horizontalOverflowPx: number };
      }>;
      issues: unknown[];
    };
    // case 完整：1 静态路由 × 2 视口
    expect(report.plannedCases).toBe(2);
    expect(report.completedCases).toBe(2);
    expect(
      report.cases.map((entry) => [entry.route, entry.viewport.label]),
    ).toEqual([
      ["/", "desktop"],
      ["/", "mobile"],
    ]);
    expect(report.issues).toHaveLength(0);

    // ---------- 2. fatal 溢出 Candidate → recovery_pending ----------
    const fatalRunId = await seedRun(FATAL_BUNDLE, "cd-e2e-fatal");
    const fatalTriggered = await page.request.post(
      `/api/mock/validation/${fatalRunId}/run`,
      { headers: ORIGIN },
    );
    expect(fatalTriggered.status()).toBe(200);
    const fatalOutcome = (await fatalTriggered.json()) as { status: string };
    expect(fatalOutcome.status).toBe("recovery_pending");
    const [fatalRows] = await pool.execute(
      "SELECT `status`, `fatal_visual_issues`, `report_digest` FROM `generation_runs` WHERE `id` = ?",
      [fatalRunId],
    );
    const fatalRow = (fatalRows as Array<Record<string, unknown>>)[0]!;
    expect(fatalRow.status).toBe("recovery_pending");
    expect(fatalRow.report_digest).toBeTruthy();
    const fatalIssues = fatalRow.fatal_visual_issues as Array<{
      code: string;
      severity: string;
    }>;
    expect(
      fatalIssues.some(
        (issue) =>
          issue.code === "viewport_overflow" && issue.severity === "fatal",
      ),
    ).toBe(true);

    // ---------- 3. capability 面：无/伪造令牌 → 403；未登录触发 → 401 ----------
    const noToken = await page.request.get("/api/validation/bootstrap");
    expect(noToken.status()).toBe(403);
    expect(
      ((await noToken.json()) as { error?: { code: string } }).error?.code,
    ).toBe("validation_session_invalid");

    const forged = await page.request.get("/api/validation/bootstrap", {
      headers: { Authorization: "Bearer vma_val_forged-token" },
    });
    expect(forged.status()).toBe(403);

    const anonContext = await browser.newContext();
    try {
      const anon = await anonContext.newPage();
      const unauthenticated = await anon.request.post(
        `/api/mock/validation/${normalRunId}/run`,
        { headers: ORIGIN },
      );
      expect(unauthenticated.status()).toBe(401);
    } finally {
      await anonContext.close();
    }

    // ---------- 4. 重复触发已完成的 run → 409（状态机保护） ----------
    const retrigger = await page.request.post(
      `/api/mock/validation/${normalRunId}/run`,
      { headers: ORIGIN },
    );
    expect(retrigger.status()).toBe(409);
    expect(
      ((await retrigger.json()) as { error?: { code: string } }).error?.code,
    ).toBe("validation_run_not_ready");
  } finally {
    for (const runId of seededRuns) {
      await pool.execute("DELETE FROM `generation_runs` WHERE `id` = ?", [
        runId,
      ]);
    }
    await pool.end();
  }
});
