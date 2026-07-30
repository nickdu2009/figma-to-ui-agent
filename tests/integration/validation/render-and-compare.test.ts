import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectStore } from "../../../src/project-store/store.ts";
import { validationRecordSchema } from "../../../src/validation/schema.ts";
import { RenderAndCompareService } from "../../../src/validation/render-and-compare.ts";
import {
  createDesignBundleDraft,
  createUISpecDraft,
} from "../../fixtures/contracts.ts";

const executablePath = resolve(
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
const roots: string[] = [];

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createTcpServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("测试 TCP 端口不可用"));
        return;
      }
      server.close((error) => {
        if (error) {
          rejectPort(error);
        } else {
          resolvePort(address.port);
        }
      });
    });
  });
}

async function waitForReachable(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // 服务仍在启动。
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, 20),
    );
  }
  throw new Error(`等待 Preview 启动超时：${url}`);
}

async function waitForClosed(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, 20),
    );
  }
  throw new Error(`Preview 端口未关闭：${url}`);
}

async function createReferencePng(): Promise<Uint8Array> {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 320, height: 240 },
    });
    await page.setContent(
      '<main style="width:320px;height:240px;background:#fff;color:#222;font:16px sans-serif">Reference</main>',
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

async function createTallReferencePng(): Promise<Uint8Array> {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 300, height: 600 },
    });
    await page.setContent(
      [
        '<main style="width:300px;height:600px;margin:0;background:#fff">',
        '<section style="height:200px;background:#124f7a"></section>',
        '<section style="height:200px;background:#f3c74f"></section>',
        '<section style="height:200px;background:#ffffff"></section>',
        "</main>",
      ].join(""),
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

async function createTwoBandSourcePng(): Promise<Uint8Array> {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 240, height: 480 },
    });
    await page.setContent(
      [
        '<body style="margin:0">',
        '<main style="width:240px;height:480px;margin:0">',
        '<section style="height:240px;background:#d33f49"></section>',
        '<section style="height:240px;background:#33aa66"></section>',
        "</main>",
        "</body>",
      ].join(""),
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

async function createBottomBandReferencePng(): Promise<Uint8Array> {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 240, height: 240 },
    });
    await page.setContent(
      '<body style="margin:0"><main style="width:240px;height:240px;margin:0;background:#33aa66"></main></body>',
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

async function createPaddedReferencePng(): Promise<Uint8Array> {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 321, height: 300 },
    });
    await page.setContent(
      [
        '<body style="margin:0">',
        '<main style="width:321px;height:300px;margin:0">',
        '<section style="height:240px;background:#ffffff"></section>',
        '<section style="height:60px;background:#d33f49"></section>',
        "</main>",
        "</body>",
      ].join(""),
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("RenderAndCompareService", () => {
  it("使用 DesignBundle page bounds 作为 canvas 尺寸而不是 reference screenshot 尺寸", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "render-compare-"));
    roots.push(dataRoot);
    const store = new ProjectStore(dataRoot);
    const referenceBytes = await createPaddedReferencePng();
    const screenshot = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "screenshots",
      bytes: referenceBytes,
    });
    const pageSourceHash = createHash("sha256")
      .update("page-padded")
      .digest("hex");
    const bundleDraft = createDesignBundleDraft();
    bundleDraft.pages[0]!.id = "page-padded";
    bundleDraft.pages[0]!.name = "Reference padded";
    bundleDraft.pages[0]!.width = 320;
    bundleDraft.pages[0]!.height = 240;
    bundleDraft.screenshots = [screenshot];
    bundleDraft.provenance = [
      {
        entityKind: "page",
        entityId: "page-padded",
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
      {
        entityKind: "screenshot",
        entityId: screenshot.path,
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
    ];
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: bundleDraft,
    });
    const uiSpecDraft = createUISpecDraft();
    uiSpecDraft.pages = [
      {
        id: "home",
        sourcePageId: "page-padded",
        path: "/",
        title: "Reference padded",
        rootNodeId: "root",
      },
    ];
    uiSpecDraft.nodes = [
      {
        id: "root",
        kind: "section",
        semantic: "main",
        childIds: [],
        style: { width: 320, height: 240 },
        designValueRefs: [],
      },
    ];
    uiSpecDraft.actions = [];
    uiSpecDraft.behaviorFixtures = [];
    uiSpecDraft.viewports = [
      {
        id: "desktop",
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
      },
    ];
    await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: uiSpecDraft,
    });

    const service = new RenderAndCompareService({
      dataRoot,
      projectStore: store,
      browserExecutablePath: executablePath,
      runId: () => "padded-reference-run",
      now: () => new Date("2026-07-26T10:00:00.000Z"),
    });
    try {
      const output = await service.render({
        schemaVersion: "1",
        projectId: "demo-project",
        pageIds: ["home"],
        viewportIds: ["desktop"],
        comparison: {
          maxDiffPixelRatio: 0.001,
          maxDiffPixels: 10,
          timeoutMs: 10_000,
        },
      });
      expect(output.passed).toBe(true);
      expect(output.results[0]!.diffPixelCount).toBe(0);
      expect(output.results[0]!.canvasMapping).toMatchObject({
        sourcePageId: "page-padded",
        pageId: "home",
        artboard: {
          width: 320,
          height: 240,
        },
        renderMode: "native_artboard",
      });
    } finally {
      await service.close();
    }
  }, 30_000);

  it("pixel_overlay 使用 DesignBundle 源图尺寸解释裁剪 frame", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "render-compare-"));
    roots.push(dataRoot);
    const store = new ProjectStore(dataRoot);
    const sourceBytes = await createTwoBandSourcePng();
    const referenceBytes = await createBottomBandReferencePng();
    const asset = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "assets",
      bytes: sourceBytes,
    });
    const screenshot = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "screenshots",
      bytes: referenceBytes,
    });
    const pageSourceHash = createHash("sha256")
      .update("page-crop")
      .digest("hex");
    const bundleDraft = createDesignBundleDraft();
    bundleDraft.pages[0]!.id = "page-crop";
    bundleDraft.pages[0]!.name = "裁剪页";
    bundleDraft.pages[0]!.width = 240;
    bundleDraft.pages[0]!.height = 240;
    bundleDraft.pages[0]!.nodes[1]!.imageRefs = [asset.path];
    bundleDraft.assets = [asset];
    bundleDraft.screenshots = [screenshot];
    bundleDraft.provenance = [
      {
        entityKind: "page",
        entityId: "page-crop",
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
      {
        entityKind: "screenshot",
        entityId: screenshot.path,
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
    ];
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: bundleDraft,
    });
    const uiSpecDraft = createUISpecDraft();
    uiSpecDraft.pages = [
      {
        id: "home",
        sourcePageId: "page-crop",
        path: "/",
        title: "裁剪页",
        rootNodeId: "root",
      },
    ];
    uiSpecDraft.nodes = [
      {
        id: "root",
        kind: "section",
        semantic: "main",
        childIds: ["bottom-overlay"],
        style: { width: 240, height: 240 },
        designValueRefs: [],
      },
      {
        id: "bottom-overlay",
        kind: "pixel_overlay",
        assetRef: asset.path,
        alt: "下半部分裁剪",
        width: 240,
        height: 240,
        frame: { x: 0, y: 240, width: 240, height: 240 },
        childIds: [],
        designValueRefs: [],
      },
    ];
    uiSpecDraft.actions = [];
    uiSpecDraft.behaviorFixtures = [];
    uiSpecDraft.viewports = [
      {
        id: "crop",
        width: 320,
        height: 480,
        deviceScaleFactor: 1,
      },
    ];
    await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: uiSpecDraft,
    });

    const service = new RenderAndCompareService({
      dataRoot,
      projectStore: store,
      browserExecutablePath: executablePath,
      runId: () => "crop-run",
      now: () => new Date("2026-07-24T10:00:00.000Z"),
    });
    try {
      const output = await service.render({
        schemaVersion: "1",
        projectId: "demo-project",
        pageIds: ["home"],
        viewportIds: ["crop"],
        comparison: {
          maxDiffPixelRatio: 0.001,
          maxDiffPixels: 10,
          timeoutMs: 10_000,
        },
      });
      expect(output.passed).toBe(true);
      expect(output.results[0]!.diffPixelRatio).toBeLessThanOrEqual(
        0.001,
      );
      expect(output.results[0]!.canvasMapping).toEqual({
        sourcePageId: "page-crop",
        pageId: "home",
        artboard: {
          width: 240,
          height: 240,
        },
        viewport: {
          id: "crop",
          width: 320,
          height: 480,
          deviceScaleFactor: 1,
        },
        scale: 1,
        origin: { x: 0, y: 0 },
        renderMode: "native_artboard",
      });
    } finally {
      await service.close();
    }
  });

  it("长页面按 full_page 策略完整比较", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "render-compare-"));
    roots.push(dataRoot);
    const store = new ProjectStore(dataRoot);
    const referenceBytes = await createTallReferencePng();
    const screenshot = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "screenshots",
      bytes: referenceBytes,
    });
    const pageSourceHash = createHash("sha256")
      .update("page-tall")
      .digest("hex");
    const bundleDraft = createDesignBundleDraft();
    bundleDraft.pages[0]!.id = "page-tall";
    bundleDraft.pages[0]!.name = "长页";
    bundleDraft.pages[0]!.width = 300;
    bundleDraft.pages[0]!.height = 600;
    bundleDraft.screenshots = [screenshot];
    bundleDraft.provenance = [
      {
        entityKind: "page",
        entityId: "page-tall",
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
      {
        entityKind: "screenshot",
        entityId: screenshot.path,
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
    ];
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: bundleDraft,
    });
    const uiSpecDraft = createUISpecDraft();
    uiSpecDraft.pages = [
      {
        id: "home",
        sourcePageId: "page-tall",
        path: "/",
        title: "长页",
        rootNodeId: "root",
      },
    ];
    uiSpecDraft.nodes = [
      {
        id: "root",
        kind: "section",
        semantic: "main",
        childIds: ["reference", "structure-anchor"],
        designValueRefs: [],
      },
      {
        id: "reference",
        kind: "image",
        assetRef: screenshot.path,
        alt: "长页参考截图",
        fit: "contain",
        designValueRefs: [],
      },
      {
        id: "structure-anchor",
        kind: "text",
        text: "",
        variant: "caption",
        designValueRefs: [],
      },
    ];
    uiSpecDraft.actions = [];
    uiSpecDraft.behaviorFixtures = [];
    uiSpecDraft.viewports = [
      {
        id: "mobile",
        width: 320,
        height: 240,
        deviceScaleFactor: 1,
      },
    ];
    await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: uiSpecDraft,
    });
    const service = new RenderAndCompareService({
      dataRoot,
      projectStore: store,
      browserExecutablePath: executablePath,
      runId: () => "full-page-run",
      now: () => new Date("2026-07-24T10:00:00.000Z"),
    });
    try {
      const output = await service.render({
        schemaVersion: "1",
        projectId: "demo-project",
        pageIds: ["home"],
        viewportIds: ["mobile"],
        comparison: {
          maxDiffPixelRatio: 0.01,
          maxDiffPixels: 1_000,
          timeoutMs: 10_000,
        },
      });
      expect(output.passed).toBe(true);
      expect(output.results[0]!.diffPixelCount).toBe(0);
      expect(output.results[0]!.canvasMapping).toMatchObject({
        sourcePageId: "page-tall",
        pageId: "home",
        artboard: {
          width: 300,
          height: 600,
        },
        viewport: {
          id: "mobile",
          width: 320,
          height: 240,
          deviceScaleFactor: 1,
        },
        renderMode: "scroll_canvas",
      });
      expect(output.unsupportedFeatures).toEqual([
        {
          code: "screenshot_fallback_used",
          severity: "fallback_ok",
          evidenceSource: "validation_artifact",
          uiSpecNodeRefs: ["reference"],
          impact: ["visual"],
          recommendedAction: "allow_local_fallback",
        },
      ]);
    } finally {
      await service.close();
    }
  });

  it("输出 overlay 与交互控件碰撞的 unsupported feature", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "render-compare-"));
    roots.push(dataRoot);
    const store = new ProjectStore(dataRoot);
    const referenceBytes = await createReferencePng();
    const screenshot = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "screenshots",
      bytes: referenceBytes,
    });
    const pageSourceHash = createHash("sha256")
      .update("page-home")
      .digest("hex");
    const bundleDraft = createDesignBundleDraft();
    bundleDraft.pages[0]!.width = 320;
    bundleDraft.pages[0]!.height = 240;
    bundleDraft.screenshots = [screenshot];
    bundleDraft.provenance = [
      {
        entityKind: "page",
        entityId: "page-home",
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
      {
        entityKind: "screenshot",
        entityId: screenshot.path,
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
    ];
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: bundleDraft,
    });

    const uiSpecDraft = createUISpecDraft();
    uiSpecDraft.pages = [
      {
        id: "home",
        sourcePageId: "page-home",
        path: "/",
        title: "首页",
        rootNodeId: "root",
      },
    ];
    uiSpecDraft.nodes = [
      {
        id: "root",
        kind: "stack",
        direction: "vertical",
        childIds: ["overlay", "submit"],
        designValueRefs: [],
      },
      {
        id: "overlay",
        kind: "pixel_overlay",
        assetRef: screenshot.path,
        alt: "覆盖层",
        width: 100,
        height: 50,
        frame: { x: 10, y: 10, width: 100, height: 50 },
        style: { pointerEvents: "auto" },
        childIds: [],
        designValueRefs: [],
      },
      {
        id: "submit",
        kind: "button",
        label: "提交",
        variant: "primary",
        frame: { x: 80, y: 30, width: 80, height: 40 },
        designValueRefs: [],
      },
    ];
    uiSpecDraft.actions = [];
    uiSpecDraft.behaviorFixtures = [];
    await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: uiSpecDraft,
    });

    const service = new RenderAndCompareService({
      dataRoot,
      projectStore: store,
      browserExecutablePath: executablePath,
      runId: () => "overlay-run",
      now: () => new Date("2026-07-24T10:00:00.000Z"),
    });
    try {
      const output = await service.render({
        schemaVersion: "1",
        projectId: "demo-project",
        pageIds: ["home"],
        viewportIds: ["desktop"],
        comparison: {
          maxDiffPixelRatio: 1,
          maxDiffPixels: 1_000_000,
          timeoutMs: 10_000,
        },
      });
      expect(output.unsupportedFeatures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "renderer_limit_overlay_collision",
            severity: "must_support",
            uiSpecNodeRefs: ["overlay"],
          }),
        ]),
      );
      expect(output.results[0]!.regionDiffs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "visual_assets",
            label: "visual assets",
            bounds: expect.objectContaining({
              x: 10,
              y: 10,
              width: 100,
              height: 50,
            }),
          }),
        ]),
      );
    } finally {
      await service.close();
    }
  });

  it("行为 fixture 可以填写 data-ui-node-id 位于自身的输入控件", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "render-compare-"));
    roots.push(dataRoot);
    const store = new ProjectStore(dataRoot);
    const referenceBytes = await createReferencePng();
    const screenshot = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "screenshots",
      bytes: referenceBytes,
    });
    const pageSourceHash = createHash("sha256")
      .update("page-home")
      .digest("hex");
    const bundleDraft = createDesignBundleDraft();
    bundleDraft.pages[0]!.width = 320;
    bundleDraft.pages[0]!.height = 240;
    bundleDraft.screenshots = [screenshot];
    bundleDraft.provenance = [
      {
        entityKind: "page",
        entityId: "page-home",
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
      {
        entityKind: "screenshot",
        entityId: screenshot.path,
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
    ];
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: bundleDraft,
    });

    const uiSpecDraft = createUISpecDraft();
    uiSpecDraft.nodes = [
      {
        id: "root",
        kind: "section",
        semantic: "main",
        childIds: ["email-input"],
        style: {
          position: "relative",
          width: 320,
          height: 240,
        },
        designValueRefs: [],
      },
      {
        id: "email-input",
        kind: "input",
        label: "Email",
        stateKey: "email",
        inputType: "email",
        placeholder: "email@example.com",
        style: {
          position: "absolute",
          left: 16,
          top: 16,
          width: 180,
          height: 48,
        },
        designValueRefs: [],
      },
    ];
    uiSpecDraft.state = [
      {
        key: "email",
        valueType: "string",
        initialValue: "",
      },
    ];
    uiSpecDraft.actions = [];
    uiSpecDraft.behaviorFixtures = [
      {
        id: "direct-input-fill",
        name: "直接输入控件填写",
        viewportId: "desktop",
        initialPageId: "home",
        steps: [
          {
            kind: "fill",
            nodeId: "email-input",
            value: "alex@example.com",
          },
          {
            kind: "expect_value",
            nodeId: "email-input",
            value: "alex@example.com",
          },
        ],
      },
    ];
    uiSpecDraft.viewports = [
      {
        id: "desktop",
        width: 320,
        height: 240,
        deviceScaleFactor: 1,
      },
    ];
    await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: uiSpecDraft,
    });

    const service = new RenderAndCompareService({
      dataRoot,
      projectStore: store,
      browserExecutablePath: executablePath,
      runId: () => "direct-input-fill-run",
      now: () => new Date("2026-07-24T10:00:00.000Z"),
    });
    try {
      const output = await service.render({
        schemaVersion: "1",
        projectId: "demo-project",
        pageIds: ["home"],
        viewportIds: ["desktop"],
        behaviorFixtureIds: ["direct-input-fill"],
        comparison: {
          maxDiffPixelRatio: 1,
          maxDiffPixels: 1_000_000,
          timeoutMs: 10_000,
        },
      });
      expect(output.results[0]!.checks).toContainEqual({
        kind: "functional",
        passed: true,
        message: "direct-input-fill:fill",
      });
      expect(output.results[0]!.checks).toContainEqual({
        kind: "functional",
        passed: true,
        message: "direct-input-fill:expect_value",
      });
    } finally {
      await service.close();
    }
  });

  it("执行行为、键盘、控制台和像素检查并保存可读取证据", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "render-compare-"));
    roots.push(dataRoot);
    const store = new ProjectStore(dataRoot);
    const referenceBytes = await createReferencePng();
    const asset = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "assets",
      bytes: referenceBytes,
    });
    const screenshot = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "screenshots",
      bytes: referenceBytes,
    });
    const pageSourceHash = createHash("sha256")
      .update("page-home")
      .digest("hex");
    const detailsSourceHash = createHash("sha256")
      .update("page-details")
      .digest("hex");
    const bundleDraft = createDesignBundleDraft();
    bundleDraft.pages[0]!.width = 320;
    bundleDraft.pages[0]!.height = 240;
    bundleDraft.pages[0]!.nodes[1]!.imageRefs = [asset.path];
    bundleDraft.pages.push({
      id: "page-details",
      name: "详情",
      width: 320,
      height: 240,
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
    bundleDraft.assets = [asset];
    bundleDraft.screenshots = [screenshot];
    bundleDraft.provenance = [
      {
        entityKind: "page",
        entityId: "page-home",
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
      {
        entityKind: "screenshot",
        entityId: screenshot.path,
        origin: "figma_node",
        sourceIdHash: pageSourceHash,
      },
      {
        entityKind: "page",
        entityId: "page-details",
        origin: "figma_node",
        sourceIdHash: detailsSourceHash,
      },
      {
        entityKind: "screenshot",
        entityId: screenshot.path,
        origin: "figma_node",
        sourceIdHash: detailsSourceHash,
      },
    ];
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: bundleDraft,
    });
    const uiSpecDraft = createUISpecDraft();
    const imageNode = uiSpecDraft.nodes.find(
      (node) => node.kind === "image",
    );
    if (imageNode?.kind === "image") {
      imageNode.assetRef = asset.path;
    }
    const continueNode = uiSpecDraft.nodes.find(
      (node) => node.id === "continue",
    );
    if (continueNode?.kind === "button") {
      continueNode.actionId = "go-details";
    }
    uiSpecDraft.pages.push({
      id: "details",
      sourcePageId: "page-details",
      path: "/details",
      title: "详情",
      rootNodeId: "details-root",
    });
    uiSpecDraft.nodes.push(
      {
        id: "details-root",
        kind: "stack",
        direction: "vertical",
        childIds: ["details-title", "back-home"],
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
        id: "back-home",
        kind: "button",
        label: "返回",
        actionId: "go-home",
        variant: "secondary",
        designValueRefs: [],
      },
    );
    uiSpecDraft.actions = [
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
    uiSpecDraft.behaviorFixtures = [
      {
        id: "multipage-flow",
        name: "多页往返",
        viewportId: "desktop",
        initialPageId: "home",
        steps: [
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
    uiSpecDraft.viewports = [
      {
        id: "desktop",
        width: 320,
        height: 240,
        deviceScaleFactor: 1,
      },
    ];
    await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: uiSpecDraft,
    });

    const runIds = [
      "flow-run",
      "strict-run",
      "missing-reference-run",
    ];
    let runIndex = 0;
    const service = new RenderAndCompareService({
      dataRoot,
      projectStore: store,
      browserExecutablePath: executablePath,
      runId: () => runIds[runIndex++]!,
      now: () => new Date("2026-07-23T10:00:00.000Z"),
    });
    try {
      const output = await service.render({
        schemaVersion: "1",
        projectId: "demo-project",
        pageIds: ["home"],
        viewportIds: ["desktop"],
        behaviorFixtureIds: ["multipage-flow"],
        comparison: {
          maxDiffPixelRatio: 1,
          maxDiffPixels: 1_000_000,
          timeoutMs: 10_000,
        },
      });
      expect(
        output.results[0]!.checks.filter((check) => !check.passed),
      ).toEqual([]);
      expect(output).toMatchObject({
        projectId: "demo-project",
        runId: "flow-run",
        passed: true,
        previewUrl: expect.stringMatching(
          /^http:\/\/127\.0\.0\.1:\d+\//,
        ),
        results: [
          {
            pageId: "home",
            viewportId: "desktop",
            expectedImage:
              "runs/flow-run/screenshots/000-f96ca2270afe-expected.png",
            actualImage:
              "runs/flow-run/screenshots/000-f96ca2270afe-actual.png",
            diffImage:
              "runs/flow-run/diffs/000-f96ca2270afe-diff.png",
          },
        ],
      });
      expect(
        output.results[0]!.checks.map((check) => check.kind),
      ).toEqual(
        expect.arrayContaining([
          "functional",
          "keyboard",
          "console",
          "visual",
        ]),
      );
      expect(output.results[0]!.diffPixelCount).toBeGreaterThan(0);
      const record = validationRecordSchema.parse(
        JSON.parse(
          await readFile(
            join(
              dataRoot,
              "projects/demo-project/runs/flow-run/validation.json",
            ),
            "utf8",
          ),
        ),
      );
      expect(record.output).toEqual(output);

      const previewResponse = await fetch(output.previewUrl);
      expect(previewResponse.status).toBe(200);
      const validationResponse = await fetch(
        `${new URL(output.previewUrl).origin}/api/projects/demo-project/runs/flow-run`,
      );
      expect(validationResponse.status).toBe(200);
      const actualImageResponse = await fetch(
        `${new URL(output.previewUrl).origin}/api/projects/demo-project/run-files/flow-run/screenshots/000-f96ca2270afe-actual.png`,
      );
      expect(actualImageResponse.status).toBe(200);
      expect(actualImageResponse.headers.get("content-type")).toBe(
        "image/png",
      );
      const unregisteredImageResponse = await fetch(
        `${new URL(output.previewUrl).origin}/api/projects/demo-project/run-files/flow-run/screenshots/not-registered.png`,
      );
      expect(unregisteredImageResponse.status).toBe(404);
      const invalidRunResponse = await fetch(
        `${new URL(output.previewUrl).origin}/api/projects/demo-project/runs/bad!`,
      );
      expect(invalidRunResponse.status).toBe(400);
      const missingRunResponse = await fetch(
        `${new URL(output.previewUrl).origin}/api/projects/demo-project/runs/missing-run`,
      );
      expect(missingRunResponse.status).toBe(404);

      const firstPreviewOrigin = new URL(
        output.previewUrl,
      ).origin;
      await service.close();
      await waitForClosed(firstPreviewOrigin);

      const strictOutput = await service.render({
        schemaVersion: "1",
        projectId: "demo-project",
        pageIds: ["home"],
        viewportIds: ["desktop"],
        behaviorFixtureIds: ["multipage-flow"],
        comparison: {
          maxDiffPixelRatio: 0,
          maxDiffPixels: 0,
          timeoutMs: 10_000,
        },
      });
      expect(strictOutput.passed).toBe(false);
      expect(
        strictOutput.results[0]!.checks.find(
          (check) => check.kind === "visual",
        ),
      ).toMatchObject({ passed: false });
      expect(strictOutput.results[0]!.diffImage).toMatch(
        /^runs\/strict-run\/diffs\//,
      );

      const bundleWithoutReference =
        structuredClone(bundleDraft);
      bundleWithoutReference.screenshots = [];
      bundleWithoutReference.provenance =
        bundleWithoutReference.provenance.filter(
          (entry) => entry.entityKind !== "screenshot",
        );
      await store.saveDesignBundle({
        projectId: "demo-project",
        baseRevision: 1,
        draft: bundleWithoutReference,
      });
      const strictPreviewOrigin = new URL(
        strictOutput.previewUrl,
      ).origin;
      await expect(
        service.render({
          schemaVersion: "1",
          projectId: "demo-project",
          pageIds: ["home"],
          viewportIds: ["desktop"],
          comparison: {
            maxDiffPixelRatio: 1,
            maxDiffPixels: 1_000_000,
            timeoutMs: 10_000,
          },
        }),
      ).rejects.toMatchObject({
        code: "reference_screenshot_missing",
      });
      await waitForClosed(strictPreviewOrigin);

      await store.saveDesignBundle({
        projectId: "demo-project",
        baseRevision: 2,
        draft: bundleDraft,
      });
      const currentSpec = await store.loadUISpec("demo-project");
      const { revision: _revision, ...cancellableSpec } =
        structuredClone(currentSpec);
      cancellableSpec.sourceDesignBundleRevision = 3;
      cancellableSpec.viewports = Array.from(
        { length: 20 },
        (_, index) => ({
          id: index === 0 ? "desktop" : `desktop-${index}`,
          width: 320,
          height: 240,
          deviceScaleFactor: 1,
        }),
      );
      await store.saveUISpec({
        projectId: "demo-project",
        baseRevision: 1,
        draft: cancellableSpec,
      });

      const cancellationPort = await freePort();
      const cancellationOrigin = `http://127.0.0.1:${cancellationPort}`;
      const cancellationService = new RenderAndCompareService({
        dataRoot,
        projectStore: store,
        browserExecutablePath: executablePath,
        previewPort: cancellationPort,
        runId: () => "cancel-run",
      });
      const controller = new AbortController();
      try {
        const cancelledRender = cancellationService.render(
          {
            schemaVersion: "1",
            projectId: "demo-project",
            pageIds: ["home"],
            viewportIds: cancellableSpec.viewports.map(
              (viewport) => viewport.id,
            ),
            comparison: {
              maxDiffPixelRatio: 1,
              maxDiffPixels: 1_000_000,
              timeoutMs: 10_000,
            },
          },
          controller.signal,
        );
        await waitForReachable(cancellationOrigin);
        controller.abort();
        await expect(cancelledRender).rejects.toMatchObject({
          code: "cancelled",
        });
        await waitForClosed(cancellationOrigin);
      } finally {
        await cancellationService.close();
      }
    } finally {
      await service.close();
    }
  });
});
