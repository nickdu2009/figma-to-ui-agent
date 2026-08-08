import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectStore } from "../../../src/project-store/store.ts";
import {
  createMultipageFlowDesignBundleDraft,
  createMultipageFlowUISpecDraft,
} from "../../fixtures/flow-plan/multipage-flow.ts";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function writeManifest(root: string): Promise<string> {
  const path = join(root, "manifest.json");
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: "1",
        corpusId: "flow-m9-integration",
        samples: [
          {
            sampleId: "community-mobile-001",
            category: "mobile-app",
            title: "Fitness",
            accessStatus: "rest_readable_node_selected",
            designUrl: "https://www.figma.com/design/ABCDEFGH/Fitness",
            nodeId: "1:1",
            expectedViewport: "mobile",
          },
          {
            sampleId: "community-login-001",
            category: "login-register",
            title: "Login",
            accessStatus: "rest_readable_node_selected",
            designUrl: "https://www.figma.com/design/ABCDEFGH/Login",
            nodeId: "1:2",
            expectedViewport: "mobile",
          },
          {
            sampleId: "community-dashboard-001",
            category: "dashboard",
            title: "Dashboard",
            accessStatus: "rest_readable_node_selected",
            designUrl: "https://www.figma.com/design/ABCDEFGH/Dashboard",
            nodeId: "1:3",
            expectedViewport: "desktop",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

async function saveStateProject(root: string): Promise<void> {
  const projectId = "m9-state-project";
  const store = new ProjectStore(join(root, "data"));
  await store.initializeProject(projectId);
  const bundle = createMultipageFlowDesignBundleDraft(projectId);
  bundle.pages[0]!.nodes.push(
    {
      id: "figma-state-source",
      parentId: "figma-root",
      kind: "instance",
      name: "Variant source",
      visible: true,
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      prototypeInteractions: [
        {
          id: "figma-change-to-selected",
          source: "figma_rest",
          trigger: "click",
          actionType: "change_to",
          navigation: "CHANGE_TO",
          transitionNodeId: "figma-state-target",
        },
      ],
      warningCodes: [],
    },
    {
      id: "figma-state-target",
      parentId: "figma-root",
      kind: "component",
      name: "Variant target",
      visible: true,
      variantProperties: { State: "selected" },
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      warningCodes: [],
    },
  );
  await store.saveDesignBundle({
    projectId,
    baseRevision: 0,
    draft: bundle,
  });
  const uiSpec = createMultipageFlowUISpecDraft(projectId, 1);
  const rootNode = uiSpec.nodes.find((node) => node.id === "root");
  if (rootNode?.kind === "stack") {
    rootNode.childIds.push(
      "ui-home-figma-state-source",
      "ui-home-figma-state-target",
    );
  }
  uiSpec.state.push({
    key: "state",
    valueType: "string",
    initialValue: "default",
  });
  uiSpec.nodes.push(
    {
      id: "ui-home-figma-state-source",
      kind: "button",
      label: "切换",
      variant: "secondary",
      designValueRefs: [],
    },
    {
      id: "ui-home-figma-state-target",
      kind: "text",
      text: "已选择",
      variant: "body",
      designValueRefs: [],
    },
  );
  await store.saveUISpec({ projectId, baseRevision: 0, draft: uiSpec });
}

async function saveSubmitLikeProject(root: string): Promise<void> {
  const projectId = "m9-login-project";
  const store = new ProjectStore(join(root, "data"));
  await store.initializeProject(projectId);
  await store.saveDesignBundle({
    projectId,
    baseRevision: 0,
    draft: createMultipageFlowDesignBundleDraft(projectId),
  });
  const uiSpec = createMultipageFlowUISpecDraft(projectId, 1);
  const rootNode = uiSpec.nodes.find((node) => node.id === "root");
  if (rootNode?.kind === "stack") {
    rootNode.childIds.push("login-submit");
  }
  uiSpec.nodes.push({
    id: "login-submit",
    kind: "button",
    label: "Login",
    variant: "primary",
    designValueRefs: [],
  });
  await store.saveUISpec({ projectId, baseRevision: 0, draft: uiSpec });
}

async function saveMissingEvidenceProject(root: string): Promise<void> {
  const projectId = "m9-dashboard-project";
  const store = new ProjectStore(join(root, "data"));
  await store.initializeProject(projectId);
  await store.saveDesignBundle({
    projectId,
    baseRevision: 0,
    draft: createMultipageFlowDesignBundleDraft(projectId),
  });
  await store.saveUISpec({
    projectId,
    baseRevision: 0,
    draft: createMultipageFlowUISpecDraft(projectId, 1),
  });
}

async function runFlowM9(input: {
  root: string;
  manifestPath: string;
  args?: string[];
}) {
  await execFileAsync(process.execPath, [
    resolve("scripts/run-flow-m9-restricted-live.mjs"),
    "--mode",
    "local",
    "--data-root",
    join(input.root, "data"),
    "--report-root",
    join(input.root, "reports"),
    "--run-id",
    "local",
    "--sample-manifest",
    input.manifestPath,
    "--sample-ids",
    "community-mobile-001,community-login-001,community-dashboard-001",
    "--sample-project",
    "community-mobile-001=m9-state-project",
    "--sample-project",
    "community-login-001=m9-login-project",
    "--sample-project",
    "community-dashboard-001=m9-dashboard-project",
    ...(input.args ?? []),
  ]);
  return JSON.parse(
    await readFile(
      join(input.root, "reports", "local", "summary.json"),
      "utf8",
    ),
  );
}

async function expectRunnerFailure(input: {
  root: string;
  manifestPath: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  try {
    await execFileAsync(
      process.execPath,
      [
        resolve("scripts/run-flow-m9-restricted-live.mjs"),
        "--mode",
        "restricted-live",
        "--data-root",
        join(input.root, "data"),
        "--report-root",
        join(input.root, "reports"),
        "--run-id",
        "restricted",
        "--sample-manifest",
        input.manifestPath,
        "--sample-ids",
        "community-mobile-001",
        ...(input.args ?? []),
      ],
      { env: input.env },
    );
  } catch (error) {
    return String(
      error && typeof error === "object" && "stderr" in error
        ? error.stderr
        : error,
    );
  }
  throw new Error("expected_runner_failure");
}

describe("Flow-M9 restricted-live extraction runner", () => {
  it("local 模式生成多样本 extraction report，且不泄露 Figma locator", async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-m9-local-"));
    roots.push(root);
    const manifestPath = await writeManifest(root);
    await saveStateProject(root);
    await saveSubmitLikeProject(root);
    await saveMissingEvidenceProject(root);

    const summary = await runFlowM9({ root, manifestPath });

    expect(summary.status).toBe("passed");
    expect(summary.aggregate).toMatchObject({
      totalSamples: 3,
      readableSamples: 3,
      trustedStateChange: 1,
    });
    expect(summary.aggregate.submitLikeNeedsConfirmation).toBeGreaterThan(0);
    expect(summary.aggregate.missingEvidence).toBeGreaterThan(0);
    expect(summary.input.networkBoundary).toEqual({
      figmaRestCalled: false,
      openaiCalled: false,
      mode: "local",
    });
    expect(JSON.stringify(summary)).not.toContain("https://www.figma.com");
    expect(JSON.stringify(summary)).not.toContain("fileKey");
    expect(JSON.stringify(summary)).not.toContain("designUrl");
    expect(
      summary.samples.map((sample: { artifactRefs: { flowPlanPath?: string } }) =>
        sample.artifactRefs.flowPlanPath,
      ),
    ).toEqual([
      "data/projects/m9-state-project/flow/current.json",
      "data/projects/m9-login-project/flow/current.json",
      "data/projects/m9-dashboard-project/flow/current.json",
    ]);
    const store = new ProjectStore(join(root, "data"));
    await expect(store.loadFlowPlan("m9-state-project")).resolves.toMatchObject({
      projectId: "m9-state-project",
      revision: 1,
    });
  });

  it("restricted-live 缺少网络 gate 时在触网前失败", async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-m9-gate-"));
    roots.push(root);
    const manifestPath = await writeManifest(root);
    const env = { ...process.env };
    delete env.FIGMA_API_KEY;
    delete env.FLOW_M9_RESTRICTED_LIVE_AUTHORIZED;

    const stderr = await expectRunnerFailure({
      root,
      manifestPath,
      env,
    });

    expect(stderr).toContain("figma_network_gate_missing");
  });

  it("restricted-live 缺少授权变量时在触网前失败", async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-m9-auth-gate-"));
    roots.push(root);
    const manifestPath = await writeManifest(root);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FIGMA_API_KEY: "test-token",
    };
    delete env.FLOW_M9_RESTRICTED_LIVE_AUTHORIZED;

    const stderr = await expectRunnerFailure({
      root,
      manifestPath,
      args: ["--allow-figma-network"],
      env,
    });

    expect(stderr).toContain("flow_m9_restricted_live_authorization_missing");
  });

  it("restricted-live 缺少 FIGMA_API_KEY 时在触网前失败", async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-m9-token-gate-"));
    roots.push(root);
    const manifestPath = await writeManifest(root);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FLOW_M9_RESTRICTED_LIVE_AUTHORIZED: "1",
    };
    delete env.FIGMA_API_KEY;

    const stderr = await expectRunnerFailure({
      root,
      manifestPath,
      args: ["--allow-figma-network"],
      env,
    });

    expect(stderr).toContain("figma_api_key_missing");
  });
});
