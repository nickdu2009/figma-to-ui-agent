#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createVisualAssetBackfillManifest,
} from "../src/figma/visual-asset-backfill-manifest.ts";
import { ProjectStore } from "../src/project-store/store.ts";

function parseArgs(argv) {
  const options = {
    dataRoot: "data/community-corpus-v21",
    projectId: undefined,
    report: undefined,
    output: undefined,
    maxPerPage: undefined,
  };
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const next = args[index + 1];
    switch (flag) {
      case "--dataRoot":
        options.dataRoot = next;
        index += 1;
        break;
      case "--projectId":
        options.projectId = next;
        index += 1;
        break;
      case "--report":
        options.report = next;
        index += 1;
        break;
      case "--output":
        options.output = next;
        index += 1;
        break;
      case "--maxPerPage":
        options.maxPerPage = Number.parseInt(next, 10);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (!options.projectId) {
    throw new Error("Missing --projectId");
  }
  if (options.maxPerPage !== undefined && !Number.isInteger(options.maxPerPage)) {
    throw new Error("Invalid --maxPerPage");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv);
  const store = new ProjectStore(options.dataRoot);
  const bundle = await store.loadDesignBundle(options.projectId);
  const report = options.report
    ? JSON.parse(await readFile(options.report, "utf8"))
    : undefined;
  const manifest = createVisualAssetBackfillManifest({
    bundle,
    report,
    maxPerPage: options.maxPerPage,
  });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (options.output) {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
  } else {
    process.stdout.write(serialized);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
