import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageName = "figma-developer-mcp";
const packageVersion = "0.13.2";
const packageSpec = `${packageName}@${packageVersion}`;
const flowFileKey = process.env.FIGMA_FLOW_FILE_KEY;
const flowNodeId = process.env.FIGMA_FLOW_NODE_ID;
const requiredTools = ["download_figma_images", "get_figma_data"];
const renderableTypes = new Set([
  "BOOLEAN_OPERATION",
  "COMPONENT",
  "COMPONENT_SET",
  "ELLIPSE",
  "FRAME",
  "GROUP",
  "INSTANCE",
  "LINE",
  "RECTANGLE",
  "SECTION",
  "STAR",
  "TEXT",
  "VECTOR",
]);

function readMode() {
  const index = process.argv.indexOf("--mode");
  return index === -1 ? "local" : process.argv[index + 1];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeResult(root, result) {
  const path = resolve(projectRoot, root, "framelink.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function textContent(result) {
  return (Array.isArray(result.content) ? result.content : [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function inspectDesignJson(serialized) {
  const root = JSON.parse(serialized);
  const typeCounts = new Map();
  const renderCandidates = [];
  let nodeCount = 0;
  let imageReferenceCount = 0;
  let variableBindingCount = 0;

  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }

    if (typeof value.imageRef === "string" && value.imageRef.length > 0) {
      imageReferenceCount += 1;
    }
    if (value.boundVariables && typeof value.boundVariables === "object") {
      variableBindingCount += 1;
    }

    if (typeof value.id === "string" && typeof value.type === "string") {
      nodeCount += 1;
      typeCounts.set(value.type, (typeCounts.get(value.type) ?? 0) + 1);

      if (
        renderableTypes.has(value.type) &&
        /^\d+[:|-]\d+$/.test(value.id)
      ) {
        const bounds = value.absoluteBoundingBox;
        const width =
          typeof value.width === "number"
            ? value.width
            : typeof bounds?.width === "number"
              ? bounds.width
              : 0;
        const height =
          typeof value.height === "number"
            ? value.height
            : typeof bounds?.height === "number"
              ? bounds.height
              : 0;
        renderCandidates.push({
          id: value.id.replace("-", ":"),
          type: value.type,
          area: Math.max(0, width) * Math.max(0, height),
        });
      }
    }

    for (const child of Object.values(value)) {
      visit(child);
    }
  }

  visit(root);
  renderCandidates.sort((left, right) => right.area - left.area);

  return {
    nodeCount,
    imageReferenceCount,
    variableBindingCount,
    typeCounts: Object.fromEntries(
      [...typeCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    renderNode: renderCandidates[0],
  };
}

async function readFigmaJson(endpoint, apiKey) {
  const response = await fetch(`https://api.figma.com/v1${endpoint}`, {
    headers: { "X-Figma-Token": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  let json;
  try {
    json = body.length > 0 ? JSON.parse(body) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, json };
}

async function inspectAssets(apiKey) {
  const response = await readFigmaJson(
    `/files/${flowFileKey}/images`,
    apiKey,
  );
  const images = response.json?.meta?.images ?? response.json?.images;
  return {
    httpStatus: response.status,
    readable: response.status === 200,
    imageCount:
      images && typeof images === "object"
        ? Object.values(images).filter(
            (value) => typeof value === "string" && value.length > 0,
          ).length
        : 0,
  };
}

async function inspectVariables(apiKey) {
  const response = await readFigmaJson(
    `/files/${flowFileKey}/variables/local`,
    apiKey,
  );
  const variables = response.json?.meta?.variables;
  const collections = response.json?.meta?.variableCollections;
  return {
    httpStatus: response.status,
    readable: response.status === 200,
    variableCount:
      variables && typeof variables === "object"
        ? Object.keys(variables).length
        : 0,
    collectionCount:
      collections && typeof collections === "object"
        ? Object.keys(collections).length
        : 0,
  };
}

function buildServerEnvironment(apiKey, imageDir) {
  return {
    ...getDefaultEnvironment(),
    FIGMA_API_KEY: apiKey,
    FRAMELINK_TELEMETRY: "off",
    DO_NOT_TRACK: "1",
    IMAGE_DIR: imageDir,
    npm_config_offline: "true",
    npm_config_yes: "true",
  };
}

function sanitizeError(error, secrets) {
  let message =
    error instanceof Error ? error.stack ?? error.message : String(error);
  for (const secret of secrets.filter(Boolean)) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  return message;
}

async function runLive() {
  assert.equal(
    process.env.FIGMA_LIVE_PROBE_AUTHORIZED,
    "1",
    "缺少 FIGMA_LIVE_PROBE_AUTHORIZED=1，拒绝 Figma live probe",
  );
  const apiKey = process.env.FIGMA_API_KEY;
  assert.ok(apiKey, "缺少 FIGMA_API_KEY");
  assert.ok(flowFileKey, "缺少 FIGMA_FLOW_FILE_KEY");
  assert.ok(flowNodeId, "缺少 FIGMA_FLOW_NODE_ID");

  const imageDir = await mkdtemp(
    join(tmpdir(), "figma-to-ui-agent-framelink-"),
  );
  const transport = new StdioClientTransport({
    command: "npm",
    args: [
      "exec",
      "--offline",
      "--yes",
      `--package=${packageSpec}`,
      "--",
      packageName,
      "--stdio",
      "--no-telemetry",
      "--format=json",
      `--image-dir=${imageDir}`,
    ],
    cwd: projectRoot,
    env: buildServerEnvironment(apiKey, imageDir),
    stderr: "pipe",
  });
  const client = new Client({
    name: "figma-to-ui-agent-framelink-probe",
    version: "0.0.0",
  });
  let stderr = "";
  transport.stderr?.setEncoding("utf8");
  transport.stderr?.on("data", (chunk) => {
    if (stderr.length < 16_384) {
      stderr += String(chunk);
    }
  });

  try {
    await client.connect(transport, { timeout: 60_000 });
    const listed = await client.listTools(undefined, { timeout: 30_000 });
    const listedToolNames = listed.tools
      .map((tool) => tool.name)
      .sort();
    for (const name of requiredTools) {
      assert.ok(
        listedToolNames.includes(name),
        `framelink_tool_missing:${name}`,
      );
    }

    const designResult = await client.callTool(
      {
        name: "get_figma_data",
        arguments: {
          fileKey: flowFileKey,
          nodeId: flowNodeId,
        },
      },
      undefined,
      { timeout: 120_000 },
    );
    assert.notEqual(
      designResult.isError,
      true,
      "framelink_get_figma_data_failed",
    );
    const serializedDesign = textContent(designResult);
    assert.ok(serializedDesign.length > 0, "framelink_design_data_empty");
    const design = inspectDesignJson(serializedDesign);
    assert.ok(design.nodeCount > 0, "framelink_design_nodes_empty");
    assert.ok(design.renderNode, "framelink_renderable_node_missing");

    const screenshotName = "flow-target.png";
    const imageResult = await client.callTool(
      {
        name: "download_figma_images",
        arguments: {
          fileKey: flowFileKey,
          nodes: [
            {
              nodeId: design.renderNode.id,
              fileName: screenshotName,
            },
          ],
          pngScale: 1,
          localPath: ".",
        },
      },
      undefined,
      { timeout: 120_000 },
    );
    assert.notEqual(
      imageResult.isError,
      true,
      "framelink_download_figma_images_failed",
    );
    const screenshot = await readFile(resolve(imageDir, screenshotName));
    assert.deepEqual(
      [...screenshot.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      "framelink_screenshot_not_png",
    );

    const [assets, variables] = await Promise.all([
      inspectAssets(apiKey),
      inspectVariables(apiKey),
    ]);
    assert.equal(assets.readable, true, "figma_image_fills_unreadable");

    const result = {
      schemaVersion: "1",
      status: variables.readable
        ? "passed"
        : "partial_variables_unavailable",
      package: {
        requested: packageSpec,
        serverVersion: client.getServerVersion(),
        execution: "npm_exec_offline",
      },
      security: {
        telemetryDisabled: true,
        inheritedOpenAiCredential: false,
        rawPayloadPersisted: false,
        temporaryFilesRemovedAfterProbe: true,
      },
      source: {
        fileKeySha256: sha256(flowFileKey),
        requestedNodeId: flowNodeId,
      },
      mcp: {
        listedToolNames,
        requiredToolNames: requiredTools,
      },
      design: {
        serializedBytes: Buffer.byteLength(serializedDesign, "utf8"),
        nodeCount: design.nodeCount,
        typeCounts: design.typeCounts,
        imageReferenceCount: design.imageReferenceCount,
        variableBindingCount: design.variableBindingCount,
        renderNodeId: design.renderNode.id,
        renderNodeType: design.renderNode.type,
      },
      screenshot: {
        bytes: screenshot.byteLength,
        sha256: sha256(screenshot),
        format: "png",
        scale: 1,
      },
      assets,
      variables,
      conclusion: variables.readable
        ? "Framelink MCP 可覆盖节点、截图、资产和完整变量读取。"
        : "Framelink MCP 可覆盖节点、截图和资产；完整变量读取未通过。",
    };
    await writeResult("data/probes/m0-live", result);
  } catch (error) {
    const secrets = [apiKey, flowFileKey, flowNodeId];
    const details = sanitizeError(error, secrets);
    const serverDetails = sanitizeError(stderr, secrets);
    throw new Error(
      [details, serverDetails && `framelink_stderr=${serverDetails}`]
        .filter(Boolean)
        .join("\n"),
    );
  } finally {
    await client.close().catch(() => {});
    await rm(imageDir, { recursive: true, force: true });
  }
}

async function runLocal() {
  await writeResult("data/probes/m0-local", {
    schemaVersion: "1",
    status: "ready_not_authorized",
    networkAccess: false,
    thirdPartyExecuted: false,
    package: {
      requested: packageSpec,
      execution: "npm_exec_offline",
      projectDependencyChange: false,
    },
    security: {
      telemetryDisabled: true,
      rawPayloadPersisted: false,
      liveGate: "FIGMA_LIVE_PROBE_AUTHORIZED=1",
      credentialVariable: "FIGMA_API_KEY",
      credentialPresent: Boolean(process.env.FIGMA_API_KEY),
    },
    plannedChecks: [
      "MCP tools/list",
      "get_figma_data 节点读取",
      "download_figma_images PNG 截图",
      "Figma image fills 资产计数",
      "Figma Variables API 可读性与数量",
    ],
  });
}

async function run() {
  const mode = readMode();
  if (mode === "local") {
    await runLocal();
    return;
  }
  assert.equal(mode, "live", `未知 probe mode: ${String(mode)}`);
  await runLive();
}

run().catch((error) => {
  process.stderr.write(
    `${sanitizeError(error, [
      process.env.FIGMA_API_KEY,
      flowFileKey,
      flowNodeId,
    ])}\n`,
  );
  process.exitCode = 1;
});
