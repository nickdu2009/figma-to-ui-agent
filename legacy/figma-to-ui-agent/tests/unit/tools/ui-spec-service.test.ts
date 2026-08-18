import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectStore } from "../../../src/project-store/store.ts";
import { UISpecToolService } from "../../../src/tools/ui-spec-service.ts";
import {
  createDesignBundleDraft,
  createDesignBundleDraftWithScreenshot,
  createRootScreenshotUISpecDraft,
  createUISpecDraft,
} from "../../fixtures/contracts.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("UISpecToolService", () => {
  it("保存完整 UISpec 并读取当前或历史修订", async () => {
    const root = await mkdtemp(join(tmpdir(), "ui-spec-service-"));
    roots.push(root);
    const store = new ProjectStore(root);
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraft(),
    });
    const service = new UISpecToolService(store);

    await expect(
      service.save({
        schemaVersion: "1",
        projectId: "demo-project",
        uiSpec: createUISpecDraft(),
        baseRevision: 0,
        reason: "初始生成",
      }),
    ).resolves.toEqual({
      schemaVersion: "1",
      projectId: "demo-project",
      revision: 1,
      validation: {
        schemaValid: true,
        referencesValid: true,
        warningCount: 0,
      },
    });
    await expect(
      service.load({
        schemaVersion: "1",
        projectId: "demo-project",
        revision: 1,
      }),
    ).resolves.toMatchObject({
      revision: 1,
      uiSpec: {
        projectId: "demo-project",
        revision: 1,
      },
    });
  });

  it("通过工具保存时拒绝 root 单截图 UISpec", async () => {
    const root = await mkdtemp(join(tmpdir(), "ui-spec-service-"));
    roots.push(root);
    const store = new ProjectStore(root);
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraftWithScreenshot(),
    });
    const service = new UISpecToolService(store);

    await expect(
      service.save({
        schemaVersion: "1",
        projectId: "demo-project",
        uiSpec: createRootScreenshotUISpecDraft(),
        baseRevision: 0,
        reason: "整页截图兜底",
      }),
    ).rejects.toMatchObject({
      name: "ProjectStoreError",
      code: "cross_reference_invalid",
      message: expect.stringContaining(
        "full_page_screenshot_fallback_rejected",
      ),
    });
  });

  it("保存允许的局部截图 fallback 时返回结构化审计", async () => {
    const root = await mkdtemp(join(tmpdir(), "ui-spec-service-"));
    roots.push(root);
    const store = new ProjectStore(root);
    await store.saveDesignBundle({
      projectId: "demo-project",
      baseRevision: 0,
      draft: createDesignBundleDraftWithScreenshot(),
    });
    const service = new UISpecToolService(store);
    const draft = createRootScreenshotUISpecDraft();
    const rootNode = draft.nodes.find((node) => node.id === "root");
    if (rootNode && "childIds" in rootNode) {
      rootNode.childIds = ["screenshot", "caption"];
    }
    draft.nodes.push({
      id: "caption",
      kind: "text",
      text: "结构化说明",
      variant: "caption",
      designValueRefs: [],
    });

    await expect(
      service.save({
        schemaVersion: "1",
        projectId: "demo-project",
        uiSpec: draft,
        baseRevision: 0,
        reason: "局部截图兜底",
      }),
    ).resolves.toMatchObject({
      unsupportedFeatures: [
        {
          code: "screenshot_fallback_used",
          severity: "fallback_ok",
          evidenceSource: "schema_limit",
          uiSpecNodeRefs: ["screenshot"],
          impact: ["visual"],
          recommendedAction: "allow_local_fallback",
        },
      ],
    });
  });
});
