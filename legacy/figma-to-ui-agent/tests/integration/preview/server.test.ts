import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";

import { startPreviewServer } from "../../../src/preview/server.ts";
import { ProjectStore } from "../../../src/project-store/store.ts";
import {
  createDesignBundleDraft,
  createUISpecDraft,
} from "../../fixtures/contracts.ts";
import { createPngBytes } from "../../fixtures/images.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("localhost Preview", () => {
  it("只读加载登记项目，渲染三栏并保持键盘焦点可见", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "preview-data-"));
    roots.push(dataRoot);
    const store = new ProjectStore(dataRoot);
    const asset = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "assets",
      bytes: createPngBytes(640, 480),
    });
    const screenshot = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "screenshots",
      bytes: createPngBytes(1440, 900),
    });
    const detailsScreenshot = await store.saveLocalImage({
      projectId: "demo-project",
      kind: "screenshots",
      bytes: createPngBytes(1280, 800),
    });
    const pageSourceHash = createHash("sha256")
      .update("page-home")
      .digest("hex");
    const detailsSourceHash = createHash("sha256")
      .update("page-details")
      .digest("hex");
    const bundleDraft = createDesignBundleDraft();
    bundleDraft.pages[0]!.nodes[1]!.imageRefs = [asset.path];
    bundleDraft.pages.push({
      id: "page-details",
      name: "详情",
      width: 1280,
      height: 800,
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
    bundleDraft.screenshots = [screenshot, detailsScreenshot];
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
        entityId: detailsScreenshot.path,
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
    await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 0,
      draft: uiSpecDraft,
    });
    const changedUISpecDraft = structuredClone(uiSpecDraft);
    const changedTitle = changedUISpecDraft.nodes.find(
      (node) => node.id === "title",
    );
    if (changedTitle?.kind === "text") {
      changedTitle.text = "不应出现在历史修订预览中";
    }
    await store.saveUISpec({
      projectId: "demo-project",
      baseRevision: 1,
      draft: changedUISpecDraft,
    });

    const server = await startPreviewServer({ dataRoot });
    const browser = await chromium.launch({
      executablePath: resolve(
        "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
      ),
      headless: true,
    });
    try {
      const apiResponse = await fetch(
        `${server.url}/api/projects/demo-project/ui-spec?revision=1`,
      );
      expect(apiResponse.status).toBe(200);
      expect(await apiResponse.json()).toMatchObject({
        projectId: "demo-project",
        revision: 1,
      });
      const currentResponse = await fetch(
        `${server.url}/api/projects/demo-project/ui-spec`,
      );
      expect(await currentResponse.json()).toMatchObject({
        revision: 2,
      });
      const blockedImage = await fetch(
        `${server.url}/api/projects/demo-project/files/figma/assets/${"f".repeat(
          64,
        )}.png`,
      );
      expect(blockedImage.status).toBe(404);

      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });
      await page.goto(
        `${server.url}/?projectId=demo-project&designRevision=1&specRevision=1`,
      );
      await page.locator(".implementation-canvas").waitFor();
      expect(await page.locator(".workspace-panel").count()).toBe(3);
      expect(
        await page
          .locator('[data-ui-node-id="title"]')
          .textContent(),
      ).toContain("设计预览");
      expect(await page.locator(".reference-stage img").count()).toBe(1);

      await page
        .locator('[data-ui-node-id="continue"]')
        .click();
      const detailsCanvas = page.locator(
        '.implementation-canvas[data-page-id="details"]',
      );
      await detailsCanvas.waitFor();
      expect(await detailsCanvas.count()).toBe(1);
      expect(
        await page
          .locator('[data-ui-node-id="details-title"]')
          .textContent(),
      ).toContain("详情页面");
      expect(
        await page
          .locator(".reference-panel header span")
          .textContent(),
      ).toBe("详情");

      await page.getByLabel("页面").selectOption("home");
      const homeCanvas = page.locator(
        '.implementation-canvas[data-page-id="home"]',
      );
      await homeCanvas.waitFor();
      expect(await homeCanvas.count()).toBe(1);
      await page.getByLabel("页面").selectOption("details");
      await page
        .locator('[data-ui-node-id="back-home"]')
        .click();
      await homeCanvas.waitFor();
      expect(await homeCanvas.count()).toBe(1);

      await page.keyboard.press("Tab");
      const focusedOutline = await page.evaluate(() => {
        const element = document.activeElement;
        return element
          ? getComputedStyle(element).outlineStyle
          : "none";
      });
      expect(focusedOutline).not.toBe("none");
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  });
});
