import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyFigmaRestEvidence,
  FIGMA_REST_POLICY_VERSION,
} from "../src/figma/capability-policy.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiBaseUrl = "https://api.figma.com/v1";
const flowFileKey = process.env.FIGMA_FLOW_FILE_KEY;
const flowNodeId = process.env.FIGMA_FLOW_NODE_ID;
const localResultPath = resolve(
  projectRoot,
  "data/probes/m0-local/figma-rest.json",
);
const liveResultPath = resolve(
  projectRoot,
  "data/probes/m0-live/figma-rest.json",
);
const liveReportPath = resolve(
  projectRoot,
  "reports/m0/2026-07-23-figma-rest.md",
);
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

function mapSize(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

async function writeJson(path, result) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function requestFigmaJson(endpoint, apiKey) {
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    headers: { "X-Figma-Token": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let json;

  try {
    json = bytes.length > 0 ? JSON.parse(bytes.toString("utf8")) : undefined;
  } catch {
    json = undefined;
  }

  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "unknown",
    rawByteCount: bytes.length,
    json,
  };
}

function summarizeDocument(entry) {
  const typeCounts = new Map();
  const renderCandidates = [];
  let nodeCount = 0;
  let imageReferenceCount = 0;
  let variableBindingCount = 0;

  function visit(value) {
    if (Array.isArray(value)) {
      for (const child of value) {
        visit(child);
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
      variableBindingCount += Object.keys(value.boundVariables).length;
    }

    if (typeof value.id === "string" && typeof value.type === "string") {
      nodeCount += 1;
      typeCounts.set(value.type, (typeCounts.get(value.type) ?? 0) + 1);

      if (renderableTypes.has(value.type)) {
        const bounds = value.absoluteBoundingBox;
        const width =
          typeof value.size?.x === "number"
            ? value.size.x
            : typeof bounds?.width === "number"
              ? bounds.width
              : 0;
        const height =
          typeof value.size?.y === "number"
            ? value.size.y
            : typeof bounds?.height === "number"
              ? bounds.height
              : 0;
        const area = Math.max(0, width) * Math.max(0, height);

        if (area > 0) {
          renderCandidates.push({
            id: value.id,
            type: value.type,
            area,
          });
        }
      }
    }

    for (const child of Object.values(value)) {
      visit(child);
    }
  }

  visit(entry?.document);
  renderCandidates.sort((left, right) => right.area - left.area);

  return {
    nodeCount,
    typeCounts: Object.fromEntries(
      [...typeCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    componentCount:
      mapSize(entry?.components) + mapSize(entry?.componentSets),
    styleCount: mapSize(entry?.styles),
    imageReferenceCount,
    variableBindingCount,
    renderNode: renderCandidates[0]
      ? {
          id: renderCandidates[0].id,
          type: renderCandidates[0].type,
        }
      : undefined,
  };
}

function extractImageMap(json) {
  const images = json?.meta?.images ?? json?.images;
  return images && typeof images === "object" && !Array.isArray(images)
    ? images
    : {};
}

function firstHttpsUrl(values) {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const url = new URL(value);
    assert.equal(url.protocol, "https:", "Figma 返回了非 HTTPS 图片地址");
    assert.equal(url.username, "", "Figma 图片地址包含用户名");
    assert.equal(url.password, "", "Figma 图片地址包含密码");
    return url;
  }
  return undefined;
}

async function downloadImage(url) {
  if (!url) {
    return undefined;
  }

  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());

  return {
    httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "unknown",
    byteCount: bytes.length,
    sha256: sha256(bytes),
    pngMagic: bytes.subarray(0, 8).equals(
      Buffer.from("89504e470d0a1a0a", "hex"),
    ),
  };
}

async function inspectNodes(apiKey) {
  const response = await requestFigmaJson(
    `/files/${flowFileKey}/nodes?ids=${encodeURIComponent(flowNodeId)}`,
    apiKey,
  );
  const entry = response.json?.nodes?.[flowNodeId];

  return {
    httpStatus: response.status,
    contentType: response.contentType,
    rawByteCount: response.rawByteCount,
    readable: response.status === 200 && Boolean(entry?.document),
    ...summarizeDocument(entry),
  };
}

async function inspectScreenshot(apiKey, renderNode) {
  if (!renderNode) {
    return {
      httpStatus: 0,
      readable: false,
      reason: "no_renderable_node",
    };
  }

  const response = await requestFigmaJson(
    `/images/${flowFileKey}?ids=${encodeURIComponent(renderNode.id)}&format=png&scale=1`,
    apiKey,
  );
  const imageUrl = firstHttpsUrl(
    Object.values(
      response.json?.images && typeof response.json.images === "object"
        ? response.json.images
        : {},
    ),
  );
  const download = await downloadImage(imageUrl);

  return {
    httpStatus: response.status,
    contentType: response.contentType,
    rawByteCount: response.rawByteCount,
    readable:
      response.status === 200 &&
      download?.httpStatus === 200 &&
      download.pngMagic,
    selectedNodeId: renderNode.id,
    selectedNodeType: renderNode.type,
    download,
  };
}

async function inspectAssets(apiKey) {
  const response = await requestFigmaJson(
    `/files/${flowFileKey}/images`,
    apiKey,
  );
  const images = extractImageMap(response.json);
  const imageUrls = Object.values(images).filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  const download = await downloadImage(firstHttpsUrl(imageUrls));

  return {
    httpStatus: response.status,
    contentType: response.contentType,
    rawByteCount: response.rawByteCount,
    readable: response.status === 200,
    imageCount: imageUrls.length,
    sampleDownload: download,
  };
}

async function inspectVariables(apiKey) {
  const response = await requestFigmaJson(
    `/files/${flowFileKey}/variables/local`,
    apiKey,
  );

  return {
    httpStatus: response.status,
    contentType: response.contentType,
    rawByteCount: response.rawByteCount,
    readable: response.status === 200,
    variableCount: mapSize(response.json?.meta?.variables),
    collectionCount: mapSize(response.json?.meta?.variableCollections),
  };
}

function reportStatus(result) {
  switch (result.status) {
    case "passed":
      return "通过";
    case "passed_with_optional_variables_unavailable":
      return "通过：Variables 可选能力不可用";
    default:
      return "失败";
  }
}

function imageSummary(image) {
  if (!image) {
    return "无可下载样本";
  }
  return `HTTP ${image.httpStatus}，${image.byteCount} 字节，SHA-256 ${image.sha256}，PNG 魔数 ${image.pngMagic ? "有效" : "不适用或无效"}`;
}

async function writeLiveReport(result) {
  const lines = [
    "# Figma REST API Flow 可行性探针",
    "",
    `- 执行时间：${result.executedAt}`,
    `- 结论：${reportStatus(result)}`,
    `- 门禁策略：${result.policyVersion}`,
    `- 文件标识哈希：${result.fileKeySha256}`,
    "- 调用范围：只读 Figma REST API",
    "- OpenAI 调用：否",
    "- 第三方 MCP 执行：否",
    "- Figma 写操作：否",
    "- 原始设计载荷落盘：否",
    "",
    "## 节点读取",
    "",
    `- HTTP 状态：${result.nodes.httpStatus}`,
    `- 原始响应字节数：${result.nodes.rawByteCount}`,
    `- 节点数：${result.nodes.nodeCount}`,
    `- 组件数：${result.nodes.componentCount}`,
    `- 样式数：${result.nodes.styleCount}`,
    `- 图片引用数：${result.nodes.imageReferenceCount}`,
    `- 变量绑定数：${result.nodes.variableBindingCount}`,
    "",
    "## 截图渲染",
    "",
    `- HTTP 状态：${result.screenshot.httpStatus}`,
    `- 选中节点：${result.screenshot.selectedNodeId ?? "无"} (${result.screenshot.selectedNodeType ?? "无"})`,
    `- 下载结果：${imageSummary(result.screenshot.download)}`,
    "",
    "## 图片填充",
    "",
    `- HTTP 状态：${result.assets.httpStatus}`,
    `- 图片数量：${result.assets.imageCount}`,
    `- 样本下载：${imageSummary(result.assets.sampleDownload)}`,
    "",
    "## 本地变量",
    "",
    `- HTTP 状态：${result.variables.httpStatus}`,
    `- 能力状态：${result.variablesCapability}`,
    `- 变量数量：${result.variables.variableCount}`,
    `- 变量集合数量：${result.variables.collectionCount}`,
    "",
    "## M0 判定",
    "",
    result.m0Passed
      ? result.variables.readable
        ? "节点、截图和图片填充核心门禁通过；Variables 增强能力也可用。"
        : "节点、截图和图片填充核心门禁通过；Variables 是可选增强能力，其不可用不阻塞 M0。"
      : "当前 M0 未通过。节点、截图或图片填充至少一项核心能力不可用。",
    "",
  ];

  await mkdir(dirname(liveReportPath), { recursive: true });
  await writeFile(liveReportPath, lines.join("\n"), "utf8");
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
    process.env.FIGMA_REST_LIVE_PROBE_AUTHORIZED,
    "1",
    "缺少 FIGMA_REST_LIVE_PROBE_AUTHORIZED=1，拒绝 Figma REST live probe",
  );
  const apiKey = process.env.FIGMA_API_KEY;
  assert.ok(apiKey, "缺少 FIGMA_API_KEY");
  assert.ok(flowFileKey, "缺少 FIGMA_FLOW_FILE_KEY");
  assert.ok(flowNodeId, "缺少 FIGMA_FLOW_NODE_ID");

  const nodes = await inspectNodes(apiKey);
  const screenshot = await inspectScreenshot(apiKey, nodes.renderNode);
  const assets = await inspectAssets(apiKey);
  const variables = await inspectVariables(apiKey);
  const classification = classifyFigmaRestEvidence({
    nodes,
    screenshot,
    assets,
    variables,
  });
  const result = {
    schemaVersion: "1",
    executedAt: new Date().toISOString(),
    fileKeySha256: sha256(flowFileKey),
    requestedNodeId: flowNodeId,
    networkAccess: true,
    readOnly: true,
    openAICalled: false,
    thirdPartyMcpExecuted: false,
    figmaMutationAttempted: false,
    rawPayloadPersisted: false,
    nodes,
    screenshot,
    assets,
    variables,
    ...classification,
  };

  await writeJson(liveResultPath, result);
  await writeLiveReport(result);
}

async function reassessLiveEvidence() {
  const existing = JSON.parse(await readFile(liveResultPath, "utf8"));
  assert.equal(existing.schemaVersion, "1", "不支持的现有证据版本");
  assert.equal(existing.rawPayloadPersisted, false, "拒绝重算原始载荷证据");
  assert.ok(existing.nodes, "现有证据缺少 nodes");
  assert.ok(existing.screenshot, "现有证据缺少 screenshot");
  assert.ok(existing.assets, "现有证据缺少 assets");
  assert.ok(existing.variables, "现有证据缺少 variables");

  const result = {
    ...existing,
    originalPolicyStatus: existing.originalPolicyStatus ?? existing.status,
    policyReassessedAt: new Date().toISOString(),
    ...classifyFigmaRestEvidence(existing),
  };

  await writeJson(liveResultPath, result);
  await writeLiveReport(result);
}

async function run() {
  const mode = readMode();
  if (mode === "local") {
    await writeJson(localResultPath, {
      schemaVersion: "1",
      status: "not_authorized",
      networkAccess: false,
      readOnly: true,
      openAICalled: false,
      thirdPartyMcpExecuted: false,
      figmaMutationAttempted: false,
      rawPayloadPersisted: false,
      policyVersion: FIGMA_REST_POLICY_VERSION,
      endpointCategories: ["nodes", "screenshot", "image_fills", "variables"],
      reason: "本地模式不执行 Figma REST 网络请求。",
    });
    return;
  }

  if (mode === "reassess") {
    await reassessLiveEvidence();
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
