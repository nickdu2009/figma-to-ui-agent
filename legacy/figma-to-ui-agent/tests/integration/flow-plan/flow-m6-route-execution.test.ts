import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";

import { parseFlowM6RouteExecutionReport } from "../../../src/flow-plan/m6-report.ts";
import { buildFlowPlan } from "../../../src/flow-plan/service.ts";
import { ProjectStore } from "../../../src/project-store/store.ts";
import {
  createMultipageFlowDesignBundleDraft,
  createMultipageFlowUISpecDraft,
  withFlowScreenshots,
} from "../../fixtures/flow-plan/multipage-flow.ts";
import { createInteractionSupplement } from "../../fixtures/flow-plan/interaction-supplement.ts";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const executablePath = resolve(
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

async function createReferencePng(
  text: string,
  background: string,
): Promise<Uint8Array> {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 320, height: 240 },
    });
    await page.setContent(
      `<main style="display:grid;width:320px;height:240px;place-items:center;background:${background};color:#222;font:600 24px Arial,sans-serif">${text}</main>`,
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

async function createProjectFixture(
  store: ProjectStore,
  projectId: string,
) {
  const [homeBytes, quoteBytes, assetBytes] = await Promise.all([
    createReferencePng("Home reference", "#ffffff"),
    createReferencePng("Quote reference", "#ffffff"),
    createReferencePng("Asset", "#ffffff"),
  ]);
  const [homeScreenshot, quoteScreenshot, asset] = await Promise.all([
    store.saveLocalImage({
      projectId,
      kind: "screenshots",
      bytes: homeBytes,
    }),
    store.saveLocalImage({
      projectId,
      kind: "screenshots",
      bytes: quoteBytes,
    }),
    store.saveLocalImage({
      projectId,
      kind: "assets",
      bytes: assetBytes,
    }),
  ]);

  const bundleDraft = withFlowScreenshots(
    createMultipageFlowDesignBundleDraft(projectId),
    homeScreenshot,
    quoteScreenshot,
  );
  bundleDraft.assets = [asset];
  bundleDraft.pages[0]!.nodes[1]!.imageRefs = [asset.path];
  const bundle = await store.saveDesignBundle({
    projectId,
    baseRevision: 0,
    draft: bundleDraft,
  });

  const uiSpecDraft = createMultipageFlowUISpecDraft(projectId);
  const imageNode = uiSpecDraft.nodes.find((node) => node.id === "image");
  if (imageNode?.kind === "image") {
    imageNode.assetRef = asset.path;
  }
  const uiSpec = await store.saveUISpec({
    projectId,
    baseRevision: 0,
    draft: uiSpecDraft,
  });

  return { bundle, uiSpec };
}

describe("Flow-M6 route_execution_only runner", () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    );
  });

  it("只转换可信 navigate interaction，并通过 Preview/Playwright 行为验证", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "flow-m6-route-"));
    roots.push(tempRoot);
    const dataRoot = join(tempRoot, "data");
    const reportRoot = join(tempRoot, "reports");
    const projectId = "demo-project";
    const store = new ProjectStore(dataRoot);
    const { bundle, uiSpec } = await createProjectFixture(store, projectId);

    const flowPlan = buildFlowPlan({
      bundle,
      uiSpec,
      interactionSupplement: createInteractionSupplement(projectId),
      figmaInteractionSource: "present",
    });
    await store.saveFlowPlan({
      projectId,
      baseRevision: 0,
      draft: flowPlan,
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "scripts/run-flow-m6.mjs",
        "--project-id",
        projectId,
        "--data-root",
        dataRoot,
        "--report-root",
        reportRoot,
        "--save-ui-spec",
        "--run-compare",
        "--run-id",
        "flow-m6-run",
        "--browser-executable-path",
        executablePath,
        "--comparison-json",
        JSON.stringify({
          maxDiffPixelRatio: 1,
          maxDiffPixels: 1_000_000,
          timeoutMs: 10_000,
        }),
      ],
      {
        cwd: resolve("."),
        timeout: 30_000,
      },
    );

    const report = parseFlowM6RouteExecutionReport(JSON.parse(stdout));
    expect(report).toMatchObject({
      schemaVersion: "1",
      milestone: "Flow-M6",
      scope: "route_execution_only",
      status: "passed",
      figmaInteractionSource: "present",
      sourceDesignBundleRevision: 1,
      sourceUISpecRevision: 1,
      sourceFlowPlanRevision: 1,
      savedUISpecRevision: 2,
      navigateActionCount: 1,
      behaviorFixtureCount: 1,
    });
    expect(report.convertedNavigateActionIds).toEqual([
      "flow-figma-continue-to-quote",
    ]);
    expect(report.behaviorFixtureIds).toEqual([
      "flow-figma-continue-to-quote-fixture",
    ]);
    expect(report.validation?.passed).toBe(true);
    expect(report.validation?.failedCheckCount).toBe(0);

    const savedUISpec = await store.loadUISpec(projectId);
    expect(savedUISpec.revision).toBe(2);
    expect(savedUISpec.sourceFlowPlanRevision).toBe(1);
    expect(savedUISpec.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "flow-figma-continue-to-quote",
          kind: "navigate",
          pageId: "quote",
        }),
      ]),
    );

    const savedReport = parseFlowM6RouteExecutionReport(
      JSON.parse(
        await readFile(
          join(reportRoot, "flow-m6-run", "summary.json"),
          "utf8",
        ),
      ),
    );
    expect(savedReport.behaviorFixtureIds).toEqual(
      report.behaviorFixtureIds,
    );
    const savedMarkdown = await readFile(
      join(reportRoot, "flow-m6-run", "summary.md"),
      "utf8",
    );
    expect(savedMarkdown).toContain("Flow-M6");
    expect(savedMarkdown).not.toContain("figma.com");
    expect(savedMarkdown).not.toContain("fileKey");
  }, 30_000);

  it("没有可信 navigate interaction 时返回 partial，且不保存 UISpec", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "flow-m6-partial-"));
    roots.push(tempRoot);
    const dataRoot = join(tempRoot, "data");
    const reportRoot = join(tempRoot, "reports");
    const projectId = "demo-project";
    const store = new ProjectStore(dataRoot);
    const { bundle, uiSpec } = await createProjectFixture(store, projectId);

    const flowPlan = buildFlowPlan({
      bundle,
      uiSpec,
      figmaInteractionSource: "absent",
    });
    await store.saveFlowPlan({
      projectId,
      baseRevision: 0,
      draft: flowPlan,
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "scripts/run-flow-m6.mjs",
        "--project-id",
        projectId,
        "--data-root",
        dataRoot,
        "--report-root",
        reportRoot,
        "--save-ui-spec",
        "--run-id",
        "flow-m6-partial",
      ],
      {
        cwd: resolve("."),
        timeout: 30_000,
      },
    );

    const report = parseFlowM6RouteExecutionReport(JSON.parse(stdout));
    expect(report.status).toBe("partial");
    expect(report.convertedNavigateActionIds).toEqual([]);
    expect(report.behaviorFixtureIds).toEqual([]);
    expect(report.insufficientReason).toContain(
      "没有可信 navigate interaction",
    );
    const savedUISpec = await store.loadUISpec(projectId);
    expect(savedUISpec.revision).toBe(1);
    expect(savedUISpec).not.toHaveProperty("sourceFlowPlanRevision");
  }, 30_000);
});
