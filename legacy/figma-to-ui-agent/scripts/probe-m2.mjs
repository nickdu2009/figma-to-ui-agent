import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { ProjectStore } from "../src/project-store/store.ts";
import { RenderAndCompareService } from "../src/validation/render-and-compare.ts";
import {
  createDesignBundleDraft,
  createUISpecDraft,
} from "../tests/fixtures/contracts.ts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dataRoot = resolve(projectRoot, "data");
const projectId = "m2-preview";
const projectPath = resolve(dataRoot, "projects", projectId);
const outputRoot = resolve(dataRoot, "probes", "m2");
const executablePath = resolve(
  dataRoot,
  "playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

function sourceHash(pageId) {
  return createHash("sha256").update(pageId).digest("hex");
}

async function referenceScreenshot(
  text,
  background,
  width = 640,
  height = 480,
) {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
    });
    await page.setContent(
      `<main style="display:grid;width:${width}px;height:${height}px;place-items:center;background:${background};color:#20242a;font:600 32px Arial,sans-serif">${text}</main>`,
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

async function main() {
  await rm(projectPath, { recursive: true, force: true });
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const [homeBytes, detailsBytes, assetBytes] = await Promise.all([
    referenceScreenshot("Figma 首页参考", "#e8f3f8"),
    referenceScreenshot("Figma 详情参考", "#f5eee5"),
    referenceScreenshot("产品图", "#e8f3f8", 320, 160),
  ]);
  const store = new ProjectStore(dataRoot);
  const asset = await store.saveLocalImage({
    projectId,
    kind: "assets",
    bytes: assetBytes,
  });
  const homeScreenshot = await store.saveLocalImage({
    projectId,
    kind: "screenshots",
    bytes: homeBytes,
  });
  const detailsScreenshot = await store.saveLocalImage({
    projectId,
    kind: "screenshots",
    bytes: detailsBytes,
  });

  const bundle = createDesignBundleDraft(projectId);
  bundle.pages[0].width = 640;
  bundle.pages[0].height = 480;
  bundle.pages[0].nodes[1].imageRefs = [asset.path];
  bundle.pages.push({
    id: "page-details",
    name: "详情",
    width: 640,
    height: 480,
    rootNodeIds: ["figma-details-root"],
    nodes: [
      {
        id: "figma-details-root",
        kind: "container",
        name: "Details",
        visible: true,
        styleRefs: ["style-background"],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: ["color.background"],
        warningCodes: [],
      },
    ],
  });
  bundle.assets = [asset];
  bundle.screenshots = [homeScreenshot, detailsScreenshot];
  bundle.provenance = [
    {
      entityKind: "page",
      entityId: "page-home",
      origin: "figma_node",
      sourceIdHash: sourceHash("page-home"),
    },
    {
      entityKind: "screenshot",
      entityId: homeScreenshot.path,
      origin: "figma_node",
      sourceIdHash: sourceHash("page-home"),
    },
    {
      entityKind: "page",
      entityId: "page-details",
      origin: "figma_node",
      sourceIdHash: sourceHash("page-details"),
    },
    {
      entityKind: "screenshot",
      entityId: detailsScreenshot.path,
      origin: "figma_node",
      sourceIdHash: sourceHash("page-details"),
    },
  ];
  await store.saveDesignBundle({
    projectId,
    baseRevision: 0,
    draft: bundle,
  });

  const uiSpec = createUISpecDraft(projectId);
  const imageNode = uiSpec.nodes.find((node) => node.id === "image");
  imageNode.assetRef = asset.path;
  const rootNode = uiSpec.nodes.find((node) => node.id === "root");
  rootNode.childIds = [
    "title",
    "image",
    "email",
    "terms",
    "continue",
  ];
  const continueNode = uiSpec.nodes.find(
    (node) => node.id === "continue",
  );
  continueNode.actionId = "go-details";
  uiSpec.pages.push({
    id: "details",
    sourcePageId: "page-details",
    path: "/details",
    title: "详情",
    rootNodeId: "details-root",
  });
  uiSpec.nodes.push(
    {
      id: "email",
      kind: "input",
      label: "邮箱",
      stateKey: "email",
      inputType: "email",
      placeholder: "name@example.com",
      designValueRefs: [],
    },
    {
      id: "terms",
      kind: "checkbox",
      label: "同意条款",
      stateKey: "terms",
      designValueRefs: [],
    },
    {
      id: "details-root",
      kind: "stack",
      direction: "vertical",
      childIds: ["details-title", "details-divider", "back-home"],
      gap: 16,
      padding: 32,
      designValueRefs: ["color.background"],
    },
    {
      id: "details-title",
      kind: "text",
      text: "详情页面",
      variant: "heading",
      designValueRefs: [],
    },
    {
      id: "details-divider",
      kind: "divider",
      designValueRefs: [],
    },
    {
      id: "back-home",
      kind: "button",
      label: "返回首页",
      actionId: "go-home",
      variant: "secondary",
      designValueRefs: [],
    },
  );
  uiSpec.state = [
    {
      key: "email",
      valueType: "string",
      initialValue: "",
    },
    {
      key: "terms",
      valueType: "boolean",
      initialValue: false,
    },
  ];
  uiSpec.actions = [
    {
      id: "go-details",
      kind: "navigate",
      pageId: "details",
    },
    {
      id: "go-home",
      kind: "navigate",
      pageId: "home",
    },
  ];
  uiSpec.viewports = [
    {
      id: "desktop",
      width: 640,
      height: 480,
      deviceScaleFactor: 1,
    },
    {
      id: "mobile",
      width: 360,
      height: 640,
      deviceScaleFactor: 1,
    },
  ];
  uiSpec.behaviorFixtures = [
    {
      id: "multipage-form",
      name: "表单和多页往返",
      viewportId: "desktop",
      initialPageId: "home",
      steps: [
        {
          kind: "fill",
          nodeId: "email",
          value: "test@example.com",
        },
        { kind: "toggle", nodeId: "terms" },
        { kind: "click", nodeId: "continue" },
        { kind: "expect_page", pageId: "details" },
        {
          kind: "expect_text",
          nodeId: "details-title",
          text: "详情页面",
        },
        { kind: "click", nodeId: "back-home" },
        { kind: "expect_page", pageId: "home" },
      ],
    },
  ];
  await store.saveUISpec({
    projectId,
    baseRevision: 0,
    draft: uiSpec,
  });

  const service = new RenderAndCompareService({
    dataRoot,
    projectStore: store,
    browserExecutablePath: executablePath,
    runId: () => "m2-probe-run",
    now: () => new Date("2026-07-23T11:00:00.000Z"),
  });
  let browser;
  try {
    const validation = await service.render({
      schemaVersion: "1",
      projectId,
      pageIds: ["home", "details"],
      viewportIds: ["desktop", "mobile"],
      behaviorFixtureIds: ["multipage-form"],
      comparison: {
        maxDiffPixelRatio: 1,
        maxDiffPixels: 2_000_000,
        timeoutMs: 10_000,
      },
    });
    if (!validation.passed || validation.results.length !== 4) {
      throw new Error("M2 本地验证未产生四个通过结果");
    }

    browser = await chromium.launch({
      executablePath,
      headless: true,
    });
    const desktop = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await desktop.goto(validation.previewUrl, {
      waitUntil: "networkidle",
    });
    const panelCount = await desktop.locator(".workspace-panel").count();
    if (panelCount !== 3) {
      throw new Error("桌面 Preview 未渲染三栏");
    }
    const desktopPath = resolve(outputRoot, "preview-desktop.png");
    await desktop.screenshot({
      path: desktopPath,
      fullPage: true,
    });

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const mobileUrl = new URL(validation.previewUrl);
    mobileUrl.searchParams.set("viewportId", "mobile");
    await mobile.goto(mobileUrl.href, {
      waitUntil: "networkidle",
    });
    const boxes = await mobile
      .locator(".workspace-panel")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width };
        }),
      );
    const stacked =
      boxes.length === 3 &&
      boxes[0].y < boxes[1].y &&
      boxes[1].y < boxes[2].y &&
      boxes.every((box) => box.width <= 390);
    if (!stacked) {
      throw new Error("移动 Preview 未按顺序堆叠三栏");
    }
    const mobilePath = resolve(outputRoot, "preview-mobile.png");
    await mobile.screenshot({
      path: mobilePath,
      fullPage: true,
    });

    const result = {
      schemaVersion: "1",
      status: "passed",
      networkAccess: false,
      projectId,
      runId: validation.runId,
      designBundleRevision: 1,
      uiSpecRevision: 1,
      pageCount: 2,
      viewportCount: 2,
      validationResultCount: validation.results.length,
      checksPassed: validation.results
        .flatMap((item) => item.checks)
        .every((check) => check.passed),
      desktopPanelCount: panelCount,
      mobilePanelsStacked: stacked,
      previewUrl: validation.previewUrl,
      artifacts: [
        "data/probes/m2/preview-desktop.png",
        "data/probes/m2/preview-mobile.png",
        "data/projects/m2-preview/runs/m2-probe-run/validation.json",
      ],
    };
    await writeFile(
      resolve(outputRoot, "result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await browser?.close();
    await service.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
