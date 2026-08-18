#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { FigmaImageDownloader } from "../src/figma/assets.ts";
import { FigmaInspector } from "../src/figma/inspector.ts";
import { FigmaRestClient } from "../src/figma/rest-client.ts";
import {
  parseFigmaDesignUrl,
  resolveFigmaTargetNodes,
} from "../src/figma/url.ts";
import { ProjectStore } from "../src/project-store/store.ts";
import {
  m5StaticCoverageReportSchema,
} from "../src/static-generation/report.ts";
import {
  reportToMarkdown,
} from "../src/static-generation/report-markdown.ts";
import {
  buildStaticUISpecFromDesignBundle,
} from "../src/static-generation/service.ts";
import {
  RenderAndCompareService,
} from "../src/validation/render-and-compare.ts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    projectId: undefined,
    figmaUrl: undefined,
    targetNodes: undefined,
    dataRoot: "data",
    reportRoot: "reports/m5-live-restricted",
    saveUiSpec: false,
    runCompare: false,
    viewportIds: ["desktop"],
    m4ValidationStatus: "pending",
    fontSourceDataRoot: undefined,
  };

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
      case "--targetNodes":
        options.targetNodes = next.split(",").filter(Boolean);
        index += 1;
        break;
      case "--dataRoot":
        options.dataRoot = next;
        index += 1;
        break;
      case "--reportRoot":
        options.reportRoot = next;
        index += 1;
        break;
      case "--save-ui-spec":
        options.saveUiSpec = true;
        break;
      case "--run-compare":
        options.runCompare = true;
        break;
      case "--viewportIds":
        options.viewportIds = next.split(",");
        index += 1;
        break;
      case "--m4ValidationStatus":
        options.m4ValidationStatus = next;
        index += 1;
        break;
      case "--fontSourceDataRoot":
        options.fontSourceDataRoot = next;
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function createRunId() {
  return `${Date.now().toString(36)}-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function validateRunId(runId) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) {
    throw new Error(
      `Invalid runId: ${runId}. Must be 1-128 alphanumeric, hyphen or underscore characters.`,
    );
  }
}

function fontKey(face) {
  return `${face.family}\u0000${face.weight}\u0000${face.style}`;
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
      faces.set(fontKey({ family: node.text.fontFamily, weight, style }), {
        family: node.text.fontFamily,
        weight,
        style,
      });
    }
  }
  return [...faces.values()];
}

async function loadCachedFontCatalog(sourceDataRoot) {
  const projectsRoot = join(resolve(sourceDataRoot), "projects");
  let projectEntries;
  try {
    projectEntries = await readdir(projectsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  const catalog = new Map();
  for (const entry of projectEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const bundlePath = join(projectsRoot, entry.name, "figma/current.json");
    let bundle;
    try {
      bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    for (const font of bundle.fonts ?? []) {
      const key = fontKey(font);
      if (catalog.has(key)) {
        continue;
      }
      catalog.set(key, {
        font,
        sourcePath: join(projectsRoot, entry.name, font.path),
      });
    }
  }
  return catalog;
}

async function backfillFontsFromSource({
  projectStore,
  projectId,
  designBundle,
  sourceDataRoot,
}) {
  if (!sourceDataRoot) {
    return {
      designBundle,
      status: { requested: 0, copied: 0, missing: 0 },
    };
  }
  const requiredFaces = collectTextFaces(designBundle);
  const existingFaces = new Set((designBundle.fonts ?? []).map(fontKey));
  const missingFaces = requiredFaces.filter(
    (face) => !existingFaces.has(fontKey(face)),
  );
  if (missingFaces.length === 0) {
    return {
      designBundle,
      status: { requested: requiredFaces.length, copied: 0, missing: 0 },
    };
  }

  const catalog = await loadCachedFontCatalog(sourceDataRoot);
  const nextFonts = [...(designBundle.fonts ?? [])];
  const nextProvenance = [...designBundle.provenance];
  const unresolved = [];
  let copied = 0;
  for (const face of missingFaces) {
    const cached = catalog.get(fontKey(face));
    if (!cached) {
      unresolved.push(face);
      continue;
    }
    const saved = await projectStore.saveLocalFont({
      projectId,
      bytes: await readFile(cached.sourcePath),
      family: face.family,
      weight: face.weight,
      style: face.style,
      sourceKind: cached.font.sourceKind ?? "authorized_download",
    });
    if (!nextFonts.some((font) => font.path === saved.path)) {
      nextFonts.push(saved);
      copied += 1;
    }
    if (
      !nextProvenance.some(
        (entry) =>
          entry.entityKind === "font" &&
          entry.entityId === saved.path &&
          entry.origin === saved.sourceKind,
      )
    ) {
      nextProvenance.push({
        entityKind: "font",
        entityId: saved.path,
        origin: saved.sourceKind,
      });
    }
  }

  if (copied === 0) {
    return {
      designBundle,
      status: {
        requested: requiredFaces.length,
        copied,
        missing: unresolved.length,
      },
    };
  }

  const { revision: _revision, ...draft } = designBundle;
  const savedBundle = await projectStore.saveDesignBundle({
    projectId,
    baseRevision: designBundle.revision,
    draft: {
      ...draft,
      fonts: nextFonts,
      provenance: nextProvenance,
    },
  });
  return {
    designBundle: savedBundle,
    status: {
      requested: requiredFaces.length,
      copied,
      missing: unresolved.length,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv);

  if (!options.projectId || !options.figmaUrl) {
    console.error(
      "Usage: node scripts/run-m5-live-restricted.mjs --projectId <id> --figmaUrl <url> [--targetNodes <id1,id2>] [--dataRoot <path>] [--reportRoot <path>] [--save-ui-spec] [--run-compare] [--viewportIds desktop,mobile]",
    );
    process.exit(1);
  }

  if (process.env.M5_LIVE_RESTRICTED_AUTHORIZED !== "1") {
    throw new Error("m5_live_restricted_not_authorized");
  }

  const figmaApiKey = process.env.FIGMA_API_KEY;
  if (!figmaApiKey) {
    throw new Error("figma_api_key_missing");
  }

  const m4StatusSchema = z.enum(["pending", "promoted", "not_required"]);
  const m4ValidationStatus = m4StatusSchema.parse(
    options.m4ValidationStatus,
  );

  const dataRoot = resolve(options.dataRoot);
  const reportRoot = resolve(options.reportRoot);
  const projectStore = new ProjectStore(dataRoot);
  await projectStore.initializeProject(options.projectId);

  const parsedUrl = parseFigmaDesignUrl(options.figmaUrl);
  const targetNodes = resolveFigmaTargetNodes(
    parsedUrl,
    options.targetNodes,
  );

  const restClient = new FigmaRestClient({ token: figmaApiKey });
  const imageDownloader = new FigmaImageDownloader({
    projectStore,
    fetchImpl: restClient.fetchImpl,
  });
  const inspector = new FigmaInspector({
    restClient,
    imageDownloader,
    projectStore,
  });

  await inspector.inspect(
    {
      schemaVersion: "1",
      projectId: options.projectId,
      figmaUrl: options.figmaUrl,
      targetNodes: targetNodes.length > 0 ? targetNodes : undefined,
    },
    undefined,
    { variablesMode: "disabled_restricted_live" },
  );

  let designBundle = await projectStore.loadDesignBundle(
    options.projectId,
  );
  const fontBackfill = await backfillFontsFromSource({
    projectStore,
    projectId: options.projectId,
    designBundle,
    sourceDataRoot: options.fontSourceDataRoot,
  });
  designBundle = fontBackfill.designBundle;
  if (options.fontSourceDataRoot) {
    console.log(
      `fontBackfill: requested=${fontBackfill.status.requested} copied=${fontBackfill.status.copied} missing=${fontBackfill.status.missing}`,
    );
  }

  const { uiSpecDraft, reportDraft } =
    buildStaticUISpecFromDesignBundle(designBundle, {
      m4ValidationStatus,
    });

  let uiSpecRevision = undefined;
  if (options.saveUiSpec) {
    const currentUiSpec = await projectStore
      .loadUISpec(options.projectId)
      .catch((error) => {
        if (error?.code === "not_found") {
          return undefined;
        }
        throw error;
      });
    const saved = await projectStore.saveUISpec({
      projectId: options.projectId,
      baseRevision: currentUiSpec?.revision ?? 0,
      draft: uiSpecDraft,
    });
    uiSpecRevision = saved.revision;
  }

  const runId = createRunId();
  validateRunId(runId);
  const runDir = join(reportRoot, runId);
  await mkdir(runDir, { recursive: true });

  const report = m5StaticCoverageReportSchema.parse({
    ...reportDraft,
    runId,
    projectId: options.projectId,
    uiSpecRevision,
    apiBoundary: {
      openai: false,
      figmaMe: false,
      variables: false,
    },
  });

  if (options.runCompare && uiSpecRevision !== undefined) {
    const renderService = new RenderAndCompareService({
      dataRoot,
      projectStore,
    });
    try {
      const renderOutput = await renderService.render({
        schemaVersion: "1",
        projectId: options.projectId,
        pageIds: report.pages.map((page) => page.pageId),
        viewportIds: options.viewportIds,
        comparison: {
          maxDiffPixelRatio: 0.05,
          maxDiffPixels: 10_000,
          timeoutMs: 30_000,
        },
      });

      const resultByPage = new Map();
      for (const result of renderOutput.results) {
        const existing = resultByPage.get(result.pageId);
        if (!existing || result.diffPixelRatio > existing.diffPixelRatio) {
          resultByPage.set(result.pageId, result);
        }
      }

      for (const page of report.pages) {
        const result = resultByPage.get(page.pageId);
        if (result) {
          page.comparison = {
            diffPixelRatio: result.diffPixelRatio,
            diffPixels: result.diffPixelCount,
            screenshotPaths: [
              result.expectedImage,
              result.actualImage,
              ...(result.diffImage ? [result.diffImage] : []),
            ],
          };
        }
      }
    } finally {
      await renderService.close();
    }
  }

  const summaryPath = join(runDir, "summary.json");
  const markdownPath = join(runDir, "summary.md");
  await writeFile(
    summaryPath,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    markdownPath,
    reportToMarkdown(report, {
      title: "M5 受限 Live 生成报告",
      variablesMode: "disabled_restricted_live",
    }),
  );

  console.log(`M5 live restricted report written to ${summaryPath}`);
  console.log(`M5 live restricted markdown written to ${markdownPath}`);
  console.log(`status: ${report.status}`);
  console.log(`pages: ${report.pages.length}`);
  console.log(`visualLayers: ${report.visualLayers.length}`);
  console.log(`unsupportedFeatures: ${report.unsupportedFeatures.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
