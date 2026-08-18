import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

async function createRestrictedLiveFixture(root: string): Promise<void> {
  const projectId = "restricted-live-demo";
  const store = new ProjectStore(join(root, "data"));
  await store.initializeProject(projectId);
  const bundleDraft = createMultipageFlowDesignBundleDraft(projectId);
  bundleDraft.pages[0]!.nodes.push(
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
      variantProperties: {
        State: "selected",
      },
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
    draft: bundleDraft,
  });

  const uiSpecDraft = createMultipageFlowUISpecDraft(projectId, 1);
  const rootNode = uiSpecDraft.nodes.find((node) => node.id === "root");
  if (rootNode?.kind === "stack") {
    rootNode.childIds.push(
      "ui-home-figma-state-source",
      "ui-home-figma-state-target",
    );
  }
  uiSpecDraft.state.push({
    key: "state",
    valueType: "string",
    initialValue: "default",
  });
  uiSpecDraft.nodes.push(
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
  await store.saveUISpec({
    projectId,
    baseRevision: 0,
    draft: uiSpecDraft,
  });
}

async function createNoInteractionFixture(root: string): Promise<void> {
  const projectId = "no-interaction-demo";
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

async function createDesignBundleOnlyFixture(root: string): Promise<void> {
  const projectId = "design-bundle-only-demo";
  const store = new ProjectStore(join(root, "data"));
  await store.initializeProject(projectId);
  await store.saveDesignBundle({
    projectId,
    baseRevision: 0,
    draft: createMultipageFlowDesignBundleDraft(projectId),
  });
}

async function createNavigateOnlyFixture(root: string): Promise<void> {
  const projectId = "navigate-only-demo";
  const store = new ProjectStore(join(root, "data"));
  await store.initializeProject(projectId);
  const bundleDraft = createMultipageFlowDesignBundleDraft(projectId);
  bundleDraft.pages[0]!.nodes.push({
    id: "figma-nav-source",
    parentId: "figma-root",
    kind: "instance",
    name: "Navigate source",
    visible: true,
    styleRefs: [],
    imageRefs: [],
    boundVariableRefs: [],
    designValueRefs: [],
    prototypeInteractions: [
      {
        id: "figma-navigate-to-quote",
        source: "figma_rest",
        trigger: "click",
        actionType: "node",
        navigation: "NAVIGATE",
        transitionNodeId: "figma-quote-root",
      },
    ],
    warningCodes: [],
  });
  await store.saveDesignBundle({
    projectId,
    baseRevision: 0,
    draft: bundleDraft,
  });

  const uiSpecDraft = createMultipageFlowUISpecDraft(projectId, 1);
  const rootNode = uiSpecDraft.nodes.find((node) => node.id === "root");
  if (rootNode?.kind === "stack") {
    rootNode.childIds.push("ui-home-figma-nav-source");
  }
  uiSpecDraft.nodes.push({
    id: "ui-home-figma-nav-source",
    kind: "button",
    label: "去报价",
    variant: "secondary",
    designValueRefs: [],
  });
  await store.saveUISpec({
    projectId,
    baseRevision: 0,
    draft: uiSpecDraft,
  });
}

async function runRestrictedLiveRunner(input: {
  root: string;
  projectId: string;
  runId: string;
}) {
  await execFileAsync(process.execPath, [
    resolve("scripts/run-flow-m7-restricted-live.mjs"),
    "--project-id",
    input.projectId,
    "--data-root",
    join(input.root, "data"),
    "--report-root",
    join(input.root, "reports"),
    "--run-id",
    input.runId,
    "--save-flow-plan",
  ]);
  return JSON.parse(
    await readFile(
      join(input.root, "reports", input.runId, "summary.json"),
      "utf8",
    ),
  );
}

async function expectRunnerFailure(input: {
  root: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  try {
    await execFileAsync(
      process.execPath,
      [
        resolve("scripts/run-flow-m7-restricted-live.mjs"),
        "--project-id",
        "restricted-live-demo",
        "--data-root",
        join(input.root, "data"),
        "--report-root",
        join(input.root, "reports"),
        "--run-id",
        "expected-failure",
        ...input.args,
      ],
      {
        env: input.env,
      },
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

function withoutFigmaToken(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.FIGMA_API_KEY;
  return env;
}

describe("Flow-M7 restricted-live runner", () => {
  it("从已保存 DesignBundle prototype interaction 生成可信非路由转换报告", async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-m7-restricted-"));
    roots.push(root);
    await createRestrictedLiveFixture(root);

    const summary = await runRestrictedLiveRunner({
      root,
      projectId: "restricted-live-demo",
      runId: "restricted-local",
    });
    expect(summary.input.figmaInteractionSource).toBe("present");
    expect(summary.counts.trustedNonRouteConverted).toBe(1);
    expect(summary.actions.converted).toContainEqual(
      expect.objectContaining({
        interactionId: "figma-change-to-selected",
        intent: "set_state",
      }),
    );
    expect(JSON.stringify(summary)).not.toContain("https://www.figma.com");
  });

  it("无 prototype interaction 时保持 partial，不误判通过", async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-m7-no-prototype-"));
    roots.push(root);
    await createNoInteractionFixture(root);

    const summary = await runRestrictedLiveRunner({
      root,
      projectId: "no-interaction-demo",
      runId: "no-prototype",
    });

    expect(summary.status).toBe("partial");
    expect(summary.input.figmaInteractionSource).toBe("absent");
    expect(summary.counts.trustedNonRouteConverted).toBe(0);
    expect(summary.reasons).toContain(
      "flow_m7_no_trusted_non_route_interaction",
    );
  });

  it("缺少 UISpec 时自动从 DesignBundle 生成静态 UISpec 后继续报告", async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-m7-generate-ui-spec-"));
    roots.push(root);
    await createDesignBundleOnlyFixture(root);

    const summary = await runRestrictedLiveRunner({
      root,
      projectId: "design-bundle-only-demo",
      runId: "generated-ui-spec",
    });
    const store = new ProjectStore(join(root, "data"));
    const uiSpec = await store.loadUISpec("design-bundle-only-demo");

    expect(uiSpec.revision).toBe(summary.input.uiSpecRevision);
    expect(summary.status).toBe("partial");
    expect(summary.reasons).toContain(
      "flow_m7_no_trusted_non_route_interaction",
    );
  });

  it("NAVIGATE-only interaction 不计入 Flow-M7 可信非路由通过", async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-m7-navigate-only-"));
    roots.push(root);
    await createNavigateOnlyFixture(root);

    const summary = await runRestrictedLiveRunner({
      root,
      projectId: "navigate-only-demo",
      runId: "navigate-only",
    });

    expect(summary.status).toBe("partial");
    expect(summary.input.figmaInteractionSource).toBe("present");
    expect(summary.counts.trustedNonRouteConverted).toBe(0);
    expect(summary.actions.converted).toContainEqual(
      expect.objectContaining({
        interactionId: "figma-navigate-to-quote",
        intent: "navigate",
      }),
    );
    expect(summary.reasons).toContain(
      "flow_m7_no_trusted_non_route_interaction",
    );
  });

  it("提供 Figma URL 但未授权网络 gate 时在触网前失败", async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-m7-gate-missing-"));
    roots.push(root);

    const stderr = await expectRunnerFailure({
      root,
      args: [
        "--figma-url",
        "https://www.figma.com/design/ABCDEFGH/Test?node-id=1-2",
      ],
      env: withoutFigmaToken(),
    });

    expect(stderr).toContain("figma_network_gate_missing");
  });

  it("授权网络 gate 但缺少 FIGMA_API_KEY 时在触网前失败", async () => {
    const root = await mkdtemp(join(tmpdir(), "flow-m7-token-missing-"));
    roots.push(root);

    const stderr = await expectRunnerFailure({
      root,
      args: [
        "--figma-url",
        "https://www.figma.com/design/ABCDEFGH/Test?node-id=1-2",
        "--allow-figma-network",
      ],
      env: {
        ...withoutFigmaToken(),
        FLOW_M7_RESTRICTED_LIVE_AUTHORIZED: "1",
      },
    });

    expect(stderr).toContain("figma_api_key_missing");
  });
});
