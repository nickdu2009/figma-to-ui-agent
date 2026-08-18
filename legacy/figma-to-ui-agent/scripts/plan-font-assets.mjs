#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ProjectStore } from "../src/project-store/store.ts";

function parseArgs(argv) {
  const options = {
    dataRoot: "data/community-corpus-v21",
    projectIds: [],
    output: undefined,
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
      case "--projectIds":
        options.projectIds = next.split(",").filter(Boolean);
        index += 1;
        break;
      case "--output":
        options.output = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.projectIds.length < 1) {
    throw new Error("Missing --projectIds");
  }
  return options;
}

function collectTextFaces(bundle) {
  const faces = new Map();
  for (const page of bundle.pages) {
    for (const node of page.nodes) {
      if (node.kind !== "text" || !node.text?.fontFamily) {
        continue;
      }
      const weight = node.text.fontWeight;
      if (!Number.isInteger(weight)) {
        continue;
      }
      const style = "normal";
      const key = `${node.text.fontFamily}\u0000${weight}\u0000${style}`;
      const existing = faces.get(key) ?? {
        family: node.text.fontFamily,
        weight,
        style,
        textNodeCount: 0,
        sampleTexts: [],
      };
      existing.textNodeCount += 1;
      if (existing.sampleTexts.length < 5) {
        existing.sampleTexts.push(node.text.characters.slice(0, 80));
      }
      faces.set(key, existing);
    }
  }
  return [...faces.values()].sort((left, right) => {
    const familyDelta = left.family.localeCompare(right.family);
    if (familyDelta !== 0) {
      return familyDelta;
    }
    return left.weight - right.weight;
  });
}

async function main() {
  const options = parseArgs(process.argv);
  const store = new ProjectStore(options.dataRoot);
  const projects = [];
  for (const projectId of options.projectIds) {
    const bundle = await store.loadDesignBundle(projectId);
    projects.push({
      projectId,
      designBundleRevision: bundle.revision,
      faces: collectTextFaces(bundle),
    });
  }
  const output = {
    schemaVersion: "1",
    mode: "font-asset-plan",
    dataRoot: options.dataRoot,
    generatedAt: new Date().toISOString(),
    projects,
    importRequires:
      "FONT_ASSET_IMPORT_AUTHORIZED=1 scripts/import-font-assets.mjs --apply --confirm",
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
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
