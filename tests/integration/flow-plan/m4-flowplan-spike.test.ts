import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";

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

describe("M4 FlowPlan spike runner", () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    );
  });

  it("将 Figma supplement 转为行为夹具并通过 Preview/Playwright 验证", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "m4-flow-"));
    roots.push(tempRoot);
    const dataRoot = join(tempRoot, "data");
    const reportRoot = join(tempRoot, "reports");
    const projectId = "demo-project";
    const store = new ProjectStore(dataRoot);

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
    await store.saveDesignBundle({
      projectId,
      baseRevision: 0,
      draft: bundleDraft,
    });

    const uiSpecDraft = createMultipageFlowUISpecDraft(projectId);
    const imageNode = uiSpecDraft.nodes.find((node) => node.id === "image");
    if (imageNode?.kind === "image") {
      imageNode.assetRef = asset.path;
    }
    await store.saveUISpec({
      projectId,
      baseRevision: 0,
      draft: uiSpecDraft,
    });

    const noSupplement = await execFileAsync(
      process.execPath,
      [
        "scripts/run-m4-flowplan-spike.mjs",
        "--project-id",
        projectId,
        "--data-root",
        dataRoot,
        "--report-root",
        reportRoot,
        "--run-id",
        "m4-no-supplement",
      ],
      {
        cwd: resolve("."),
        timeout: 30_000,
      },
    );
    const noSupplementReport = JSON.parse(noSupplement.stdout);
    expect(noSupplementReport).toMatchObject({
      status: "partial",
      figmaInteractionSource: "absent",
      satisfiesMultipage: true,
    });
    expect(noSupplementReport.convertedActionIds).toEqual([]);
    expect(noSupplementReport.confirmationQuestions).toHaveLength(2);
    expect((await store.loadUISpec(projectId)).revision).toBe(1);

    const supplementPath = join(tempRoot, "supplement.json");
    await writeFile(
      supplementPath,
      `${JSON.stringify(createInteractionSupplement(projectId), null, 2)}\n`,
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "scripts/run-m4-flowplan-spike.mjs",
        "--project-id",
        projectId,
        "--data-root",
        dataRoot,
        "--report-root",
        reportRoot,
        "--interaction-supplement",
        supplementPath,
        "--save-ui-spec",
        "--run-compare",
        "--run-id",
        "m4-flow-run",
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

    const report = JSON.parse(stdout);
    expect(report.status).toBe("passed");
    expect(report.convertedActionIds).toHaveLength(1);
    expect(report.behaviorFixtureIds).toHaveLength(1);
    expect(report.validation.passed).toBe(true);
    expect(
      report.validation.results[0].checks.filter(
        (check: { passed: boolean }) => !check.passed,
      ),
    ).toEqual([]);

    const savedReport = JSON.parse(
      await readFile(
        join(reportRoot, "m4-flow-run", "summary.json"),
        "utf8",
      ),
    );
    expect(savedReport.behaviorFixtureIds).toEqual(
      report.behaviorFixtureIds,
    );
  });
});
