import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localResultPath = resolve(
  projectRoot,
  "data/probes/m0-local/figma.json",
);
const liveResultPath = resolve(
  projectRoot,
  "data/probes/m0-live/figma.json",
);
const allowedEndpoint = "http://127.0.0.1:3845/mcp";
const requiredToolNames = [
  "get_metadata",
  "get_design_context",
  "get_screenshot",
  "get_variable_defs",
];

function readMode() {
  const index = process.argv.indexOf("--mode");
  return index === -1 ? "local" : process.argv[index + 1];
}

async function writeResult(path, result) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function buildArguments(tool, nodeId) {
  const properties = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const args = {};

  if ("nodeId" in properties) {
    args.nodeId = nodeId;
    required.delete("nodeId");
  }
  if ("clientLanguages" in properties) {
    args.clientLanguages = "typescript";
    required.delete("clientLanguages");
  }
  if ("clientFrameworks" in properties) {
    args.clientFrameworks = "react";
    required.delete("clientFrameworks");
  }

  if (required.size > 0) {
    throw new Error(
      `figma_tool_schema_unsupported:${tool.name}:${[...required].join(",")}`,
    );
  }

  return args;
}

function summarizeToolResult(name, result) {
  const content = Array.isArray(result.content) ? result.content : [];
  const serialized = JSON.stringify(result);
  const localhostAssets =
    serialized.match(
      /https?:\/\/(?:127\.0\.0\.1|localhost):3845\/[^"\\\s]+/g,
    ) ?? [];

  return {
    name,
    isError: result.isError === true,
    contentTypes: content.map((item) =>
      item && typeof item === "object" ? item.type : "unknown",
    ),
    localhostAssetReferenceCount: new Set(localhostAssets).size,
  };
}

async function runLive() {
  assert.equal(
    process.env.M0_LIVE_PROBE_AUTHORIZED,
    "1",
    "缺少 M0_LIVE_PROBE_AUTHORIZED=1，拒绝 Figma live probe",
  );

  const endpoint = process.env.FIGMA_MCP_URL ?? allowedEndpoint;
  assert.equal(endpoint, allowedEndpoint, "只允许 Figma Desktop MCP 本地端点");

  const nodeId = process.env.FIGMA_FLOW_NODE_ID;
  assert.ok(nodeId, "缺少 FIGMA_FLOW_NODE_ID");

  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);

  const client = new Client({
    name: "figma-to-ui-agent-m0-probe",
    version: "0.0.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));

  try {
    await client.connect(transport, { timeout: 15_000 });
    const listed = await client.listTools(undefined, { timeout: 15_000 });
    const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));

    for (const name of requiredToolNames) {
      assert.ok(byName.has(name), `figma_tool_missing:${name}`);
    }

    const results = [];
    for (const name of requiredToolNames) {
      const tool = byName.get(name);
      const result = await client.callTool(
        {
          name,
          arguments: buildArguments(tool, nodeId),
        },
        undefined,
        { timeout: 30_000 },
      );
      const summary = summarizeToolResult(name, result);
      assert.equal(summary.isError, false, `figma_tool_failed:${name}`);
      results.push(summary);
    }

    const report = {
      schemaVersion: "1",
      status: "passed",
      endpoint,
      nodeId,
      listedToolNames: listed.tools.map((tool) => tool.name).sort(),
      requiredToolResults: results,
      rawPayloadPersisted: false,
    };
    await writeResult(liveResultPath, report);
  } finally {
    await client.close();
  }
}

async function run() {
  const mode = readMode();
  if (mode === "local") {
    await writeResult(localResultPath, {
      schemaVersion: "1",
      status: "not_authorized",
      networkAccess: false,
      endpoint: allowedEndpoint,
      requiredToolNames,
      reason: "OpenAI/Figma live probe 未获授权，因此没有连接本地 MCP。",
    });
    return;
  }

  assert.equal(mode, "live", `未知 probe mode: ${String(mode)}`);
  await runLive();
}

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
