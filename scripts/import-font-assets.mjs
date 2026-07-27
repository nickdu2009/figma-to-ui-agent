#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { z } from "zod";

import { ProjectStore } from "../src/project-store/store.ts";

const fontManifestSchema = z
  .object({
    projectId: z.string().min(1),
    dataRoot: z.string().min(1).optional(),
    fonts: z
      .array(
        z
          .object({
            sourcePath: z.string().min(1),
            family: z.string().min(1).max(256),
            weight: z.number().int().min(1).max(1_000),
            style: z.enum(["normal", "italic"]),
            sourceKind: z.enum([
              "user_provided",
              "authorized_download",
            ]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

function parseArgs(argv) {
  const options = {
    manifest: undefined,
    dataRoot: undefined,
    apply: false,
    confirm: false,
  };
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const next = args[index + 1];
    switch (flag) {
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
  if (!options.manifest) {
    throw new Error("Missing --manifest");
  }
  return options;
}

function publicFontSummary(font) {
  return {
    family: font.family,
    weight: font.weight,
    style: font.style,
    sourceKind: font.sourceKind,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  const manifest = fontManifestSchema.parse(
    JSON.parse(await readFile(options.manifest, "utf8")),
  );
  const dataRoot = options.dataRoot ?? manifest.dataRoot ?? "data";
  const authorized =
    process.env.FONT_ASSET_IMPORT_AUTHORIZED === "1" &&
    options.apply &&
    options.confirm;

  if (!authorized) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          projectId: manifest.projectId,
          dataRoot,
          fontCount: manifest.fonts.length,
          fonts: manifest.fonts.map(publicFontSummary),
          applyRequires:
            "FONT_ASSET_IMPORT_AUTHORIZED=1 --apply --confirm",
        },
        null,
        2,
      ),
    );
    return;
  }

  const store = new ProjectStore(dataRoot);
  const current = await store.loadDesignBundle(manifest.projectId);
  const nextFonts = [...current.fonts];
  const nextProvenance = [...current.provenance];
  for (const font of manifest.fonts) {
    const bytes = await readFile(font.sourcePath);
    const saved = await store.saveLocalFont({
      projectId: manifest.projectId,
      bytes,
      family: font.family,
      weight: font.weight,
      style: font.style,
      sourceKind: font.sourceKind,
    });
    if (!nextFonts.some((candidate) => candidate.path === saved.path)) {
      nextFonts.push(saved);
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

  const { revision: _revision, ...draft } = current;
  const saved = await store.saveDesignBundle({
    projectId: manifest.projectId,
    baseRevision: current.revision,
    draft: {
      ...draft,
      fonts: nextFonts,
      provenance: nextProvenance,
    },
  });
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        projectId: saved.projectId,
        designBundleRevision: saved.revision,
        fontCount: saved.fonts.length,
        addedOrReused: manifest.fonts.map(publicFontSummary),
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
