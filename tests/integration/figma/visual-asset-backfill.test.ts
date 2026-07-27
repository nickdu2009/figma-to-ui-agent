import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LocalImageRef } from "../../../src/design-bundle/schema.ts";
import { VisualAssetBackfillService } from "../../../src/figma/visual-asset-backfill.ts";
import { createVisualAssetBackfillManifest } from "../../../src/figma/visual-asset-backfill-manifest.ts";
import { ProjectStore } from "../../../src/project-store/store.ts";
import { createDesignBundleDraft } from "../../fixtures/contracts.ts";
import { createPngBytes } from "../../fixtures/images.ts";

const roots: string[] = [];
const fileKey = "BackfillDemoFile1";
const figmaUrl = `https://www.figma.com/design/${fileKey}/Demo?node-id=1-2`;

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createStoredBundle(store: ProjectStore) {
  const draft = createDesignBundleDraft("backfill-demo");
  draft.source.fileKeyHash = stableHash(fileKey);
  draft.pages[0]!.nodes.push({
    id: "1:2",
    parentId: "figma-root",
    kind: "vector",
    name: "Back icon",
    visible: true,
    bounds: { x: 10, y: 12, width: 24, height: 24 },
    visual: {
      fillCount: 0,
      strokeCount: 1,
      effectCount: 0,
      vectorPathCount: 1,
    },
    styleRefs: [],
    imageRefs: [],
    boundVariableRefs: [],
    designValueRefs: [],
    warningCodes: [],
  });
  return await store.saveDesignBundle({
    projectId: "backfill-demo",
    baseRevision: 0,
    draft,
  });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("VisualAssetBackfillService", () => {
  it("成功后原子保存一个包含节点截图 provenance 的新 DesignBundle revision", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "visual-backfill-"));
    roots.push(dataRoot);
    const store = new ProjectStore(dataRoot);
    const bundle = await createStoredBundle(store);
    const manifest = createVisualAssetBackfillManifest({ bundle });
    const service = new VisualAssetBackfillService({
      store,
      restClient: {
        getImageRenders: async (_fileKey, nodeIds) => ({
          err: null,
          images: Object.fromEntries(
            nodeIds.map((nodeId) => [
              nodeId,
              `https://static.figma.com/${nodeId}.png`,
            ]),
          ),
        }),
      },
      downloader: {
        downloadAll: async (projectId, requests) => {
          const output = new Map<string, LocalImageRef>();
          for (const request of requests) {
            output.set(
              request.sourceRef,
              await store.saveLocalImage({
                projectId,
                kind: "screenshots",
                bytes: createPngBytes(24, 24),
              }),
            );
          }
          return output;
        },
      },
    });

    const result = await service.apply({
      projectId: "backfill-demo",
      figmaUrl,
      manifest,
    });

    expect(result.nextDesignBundleRevision).toBe(2);
    const saved = await store.loadDesignBundle("backfill-demo");
    expect(saved.revision).toBe(2);
    expect(saved.screenshots).toHaveLength(1);
    expect(saved.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityKind: "node",
          entityId: "1:2",
        }),
        expect.objectContaining({
          entityKind: "screenshot",
          entityId: saved.screenshots[0]!.path,
        }),
      ]),
    );
  });

  it("fileKey hash mismatch 和 null URL 均不保存新 revision", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "visual-backfill-"));
    roots.push(dataRoot);
    const store = new ProjectStore(dataRoot);
    const bundle = await createStoredBundle(store);
    const manifest = createVisualAssetBackfillManifest({ bundle });
    const service = new VisualAssetBackfillService({
      store,
      restClient: {
        getImageRenders: async () => ({ images: { "1:2": null } }),
      },
      downloader: {
        downloadAll: async () => new Map(),
      },
    });

    await expect(
      service.plan({
        projectId: "backfill-demo",
        figmaUrl:
          "https://www.figma.com/design/OtherDemoFile1/Demo?node-id=1-2",
        manifest,
      }),
    ).rejects.toMatchObject({ code: "file_key_mismatch" });
    await expect(
      service.apply({
        projectId: "backfill-demo",
        figmaUrl,
        manifest,
      }),
    ).rejects.toMatchObject({ code: "missing_render_url" });
    await expect(
      store.loadDesignBundle("backfill-demo"),
    ).resolves.toMatchObject({ revision: 1 });
  });
});
