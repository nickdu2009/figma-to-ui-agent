import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  normalizeFigmaNodeId,
  parseFigmaDesignUrl,
} from "../src/figma/url.ts";
import {
  loadAndVerifyFreeze,
  sha256,
} from "./m3-freeze-lib.mjs";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function createSourceManifest(env = process.env) {
  const { freeze } = await loadAndVerifyFreeze(projectRoot);
  const caseId = env.M3_CASE_ID?.trim();
  const figmaUrl = env.M3_FIGMA_URL?.trim();
  if (!caseId || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(caseId)) {
    throw new Error("m3_case_id_invalid");
  }
  if (!figmaUrl) {
    throw new Error("m3_figma_url_missing");
  }
  if (env.M3_UNKNOWN_INPUT_CONFIRMED !== "1") {
    throw new Error("m3_unknown_input_attestation_missing");
  }
  const parsed = parseFigmaDesignUrl(figmaUrl);
  const sourceFileKeyHash = sha256(parsed.fileKey);
  if (
    freeze.developmentInputHashes.includes(sourceFileKeyHash)
  ) {
    throw new Error("m3_input_was_used_for_development");
  }
  const explicitNodes = (env.M3_TARGET_NODES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeFigmaNodeId);
  const targetNodes = [
    ...new Set([
      ...(parsed.nodeId ? [parsed.nodeId] : []),
      ...explicitNodes,
    ]),
  ];
  const behaviorNotes = env.M3_BEHAVIOR_NOTES?.trim();
  const manifest = {
    schemaVersion: "1",
    caseId,
    baselineId: freeze.baselineId,
    sourceFileKeyHash,
    sourceUrlHash: sha256(figmaUrl),
    targetNodeHashes: targetNodes.map(sha256),
    targetNodeCount: targetNodes.length,
    behaviorNotesHash: behaviorNotes
      ? sha256(behaviorNotes)
      : undefined,
    unknownInputAttested: true,
    createdAt: new Date().toISOString(),
  };
  const path = resolve(
    projectRoot,
    `data/blind/m3/${caseId}/source-manifest.json`,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return { manifest, path };
}

async function main() {
  const { manifest } = await createSourceManifest();
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
