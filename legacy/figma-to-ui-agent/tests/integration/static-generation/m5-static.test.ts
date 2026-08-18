import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";

import {
  m5StaticCoverageReportSchema,
} from "../../../src/static-generation/report.ts";
import { ProjectStore } from "../../../src/project-store/store.ts";
import { createM5StaticDesignBundleDraft } from "../../fixtures/static-generation/m5-static-fixture.ts";

const execFileAsync = promisify(execFile);
const executablePath = resolve(
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function createReferencePng(input: {
  width: number;
  height: number;
  background: string;
  label: string;
}): Promise<Uint8Array> {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: input.width, height: input.height },
    });
    await page.setContent(
      [
        '<body style="margin:0">',
        `<main style="width:${input.width}px;height:${input.height}px;background:${input.background};color:#172033;font:24px Inter, sans-serif;display:flex;align-items:center;justify-content:center">`,
        input.label,
        "</main>",
        "</body>",
      ].join(""),
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

async function createRunnerFixture(input: {
  projectId: string;
  dataRoot: string;
}): Promise<{
  store: ProjectStore;
  designBundleRevision: number;
}> {
  const store = new ProjectStore(input.dataRoot);
  await store.initializeProject(input.projectId);

  const [assetBytes, logoBytes, screenshotBytes, blobBytes] =
    await Promise.all([
      createReferencePng({
        width: 640,
        height: 480,
        background: "#f6f1e8",
        label: "asset",
      }),
      createReferencePng({
        width: 120,
        height: 40,
        background: "#ffffff",
        label: "logo",
      }),
      createReferencePng({
        width: 1440,
        height: 900,
        background: "#ffffff",
        label: "reference",
      }),
      createReferencePng({
        width: 800,
        height: 600,
        background: "#f3c74f",
        label: "blob",
      }),
    ]);

  const [asset, logo, screenshot, blob] = await Promise.all([
    store.saveLocalImage({
      projectId: input.projectId,
      kind: "assets",
      bytes: assetBytes,
    }),
    store.saveLocalImage({
      projectId: input.projectId,
      kind: "assets",
      bytes: logoBytes,
    }),
    store.saveLocalImage({
      projectId: input.projectId,
      kind: "screenshots",
      bytes: screenshotBytes,
    }),
    store.saveLocalImage({
      projectId: input.projectId,
      kind: "screenshots",
      bytes: blobBytes,
    }),
  ]);

  const bundle = createM5StaticDesignBundleDraft(input.projectId, {
    asset,
    logo,
    screenshot,
    blob,
  });
  const savedBundle = await store.saveDesignBundle({
    projectId: input.projectId,
    baseRevision: 0,
    draft: bundle,
  });

  return { store, designBundleRevision: savedBundle.revision };
}

async function runRunner(
  projectId: string,
  dataRoot: string,
  designBundleRevision: number,
  extraArgs: string[] = [],
): Promise<{
  report: ReturnType<typeof m5StaticCoverageReportSchema.parse>;
  summaryPath: string;
  markdown: string;
}> {
  const { stdout } = await execFileAsync(
    "node",
    [
      "scripts/run-m5-static.mjs",
      "--projectId",
      projectId,
      "--dataRoot",
      dataRoot,
      "--designBundleRevision",
      String(designBundleRevision),
      "--reportRoot",
      join(dataRoot, "reports", projectId),
      ...extraArgs,
    ],
    { cwd: process.cwd() },
  );

  const match = stdout.match(
    /M5 static report written to (.+summary\.json)/,
  );
  if (!match) {
    throw new Error("Runner did not report summary path");
  }

  const summaryPath = match[1]!;
  const raw = await readFile(summaryPath, "utf8");
  const report = m5StaticCoverageReportSchema.parse(JSON.parse(raw));
  const markdown = await readFile(
    summaryPath.replace(/summary\.json$/, "summary.md"),
    "utf8",
  );
  return { report, summaryPath, markdown };
}

describe("run-m5-static runner", () => {
  it("generates a valid M5 report from a saved DesignBundle", async () => {
    const projectId = `m5-runner-test-${Date.now()}`;
    const dataRoot = await mkdtemp(join(tmpdir(), "m5-static-"));
    roots.push(dataRoot);
    const { designBundleRevision } = await createRunnerFixture({
      projectId,
      dataRoot,
    });

    const { report, markdown } = await runRunner(
      projectId,
      dataRoot,
      designBundleRevision,
    );

    expect(report.projectId).toBe(projectId);
    expect(report.behaviorFlowVerified).toBe(false);
    expect(report.scope).toBe("static_generation_only");
    expect(report.pages.length).toBe(3);
    expect(report.visualLayers.length).toBeGreaterThan(0);

    const loginPage = report.pages.find(
      (page) => page.pageId === "login",
    );
    expect(loginPage).toBeDefined();
    expect(loginPage?.regions.find((r) => r.id === "form_fields")?.status).toBe(
      "passed",
    );
    expect(loginPage?.structuredCoverage.fullPageScreenshotFallback).toBe(
      false,
    );
    expect(markdown).toContain(`- projectId: ${projectId}`);
    expect(markdown).toContain("## 覆盖率摘要");
    expect(markdown).toContain(
      `- sourceNodeCount: ${report.coverage.aggregate.sourceNodeCount}`,
    );
    expect(markdown).toContain("- vector:");
    expect(markdown).toContain("- budgetExceeded:");
    expect(markdown).toContain("full_page");
  }, 30_000);

  it("saves UISpec when --save-ui-spec is passed", async () => {
    const projectId = `m5-runner-save-${Date.now()}`;
    const dataRoot = await mkdtemp(join(tmpdir(), "m5-static-"));
    roots.push(dataRoot);
    const { store, designBundleRevision } = await createRunnerFixture({
      projectId,
      dataRoot,
    });

    const { report } = await runRunner(projectId, dataRoot, designBundleRevision, [
      "--save-ui-spec",
    ]);

    expect(report.uiSpecRevision).toBeDefined();

    const saved = await store.loadUISpec(projectId);
    expect(saved.revision).toBe(report.uiSpecRevision);
  }, 30_000);

  it("runs render comparison when --run-compare is passed", async () => {
    const projectId = `m5-runner-compare-${Date.now()}`;
    const dataRoot = await mkdtemp(join(tmpdir(), "m5-static-"));
    roots.push(dataRoot);
    const { designBundleRevision } = await createRunnerFixture({
      projectId,
      dataRoot,
    });

    const { report } = await runRunner(projectId, dataRoot, designBundleRevision, [
      "--save-ui-spec",
      "--run-compare",
      "--runId",
      "m5-compare-test",
    ]);

    expect(report.uiSpecRevision).toBeDefined();
    expect(report.pages).toHaveLength(3);
    for (const page of report.pages) {
      expect(page.comparison).toBeDefined();
      expect(page.comparison?.screenshotPaths.length).toBeGreaterThanOrEqual(2);
    }
  }, 30_000);
});
