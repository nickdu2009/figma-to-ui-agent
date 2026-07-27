#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { FigmaImageDownloader } from "../src/figma/assets.ts";
import { FigmaRestClient } from "../src/figma/rest-client.ts";
import { VisualAssetBackfillService } from "../src/figma/visual-asset-backfill.ts";
import {
  visualAssetBackfillManifestSchema,
} from "../src/figma/visual-asset-backfill-manifest.ts";
import { ProjectStore } from "../src/project-store/store.ts";

function parseArgs(argv) {
  const options = {
    projectId: undefined,
    figmaUrl: undefined,
    manifest: undefined,
    dataRoot: "data",
    apply: false,
    confirm: false,
  };
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const next = args[index + 1];
    switch (flag) {
      case "--projectId":
        options.projectId = next;
        index += 1;
        break;
      case "--figmaUrl":
        options.figmaUrl = next;
        index += 1;
        break;
      case "--manifest":
        options.manifest = next;
        index += 1;
        break;
      case "--dataRoot":
        options.dataRoot = next;
        index += 1;
        break;
      case "--apply":
        options.apply = true;
        break;
      case "--confirm":
        options.confirm = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (!options.projectId || !options.figmaUrl || !options.manifest) {
    throw new Error("Missing --projectId, --figmaUrl or --manifest");
  }
  return options;
}

function redactedPlan(plan) {
  return {
    projectId: plan.projectId,
    designBundleRevision: plan.designBundleRevision,
    nodeCount: plan.nodeCount,
    chunkCount: plan.chunkCount,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  const manifest = visualAssetBackfillManifestSchema.parse(
    JSON.parse(await readFile(options.manifest, "utf8")),
  );
  const authorized =
    process.env.FIGMA_VISUAL_BACKFILL_AUTHORIZED === "1" &&
    options.apply &&
    options.confirm;
  const store = new ProjectStore(options.dataRoot);

  if (!authorized) {
    const service = new VisualAssetBackfillService({
      store,
      restClient: {
        getImageRenders: async () => {
          throw new Error("dry_run_no_network");
        },
      },
      downloader: {
        downloadAll: async () => {
          throw new Error("dry_run_no_network");
        },
      },
    });
    const plan = await service.plan({
      projectId: options.projectId,
      figmaUrl: options.figmaUrl,
      manifest,
    });
    console.log(
      JSON.stringify(
        {
          mode: "plan",
          ...redactedPlan(plan),
          applyRequires:
            "FIGMA_VISUAL_BACKFILL_AUTHORIZED=1 --apply --confirm",
        },
        null,
        2,
      ),
    );
    return;
  }

  const token = process.env.FIGMA_API_KEY;
  if (!token) {
    throw new Error("Missing FIGMA_API_KEY");
  }
  const restClient = new FigmaRestClient({ token });
  const service = new VisualAssetBackfillService({
    store,
    restClient,
    downloader: new FigmaImageDownloader({ projectStore: store }),
  });
  const result = await service.apply({
    projectId: options.projectId,
    figmaUrl: options.figmaUrl,
    manifest,
  });
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        ...redactedPlan(result),
        nextDesignBundleRevision: result.nextDesignBundleRevision,
        registeredImageCount: result.registeredImages.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
