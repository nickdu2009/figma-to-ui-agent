import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runProductM9Flow } from "../../../src/runtime/product-m9-flow-service.ts";
import { createFigmaFileResponseFixture } from "../../fixtures/figma/file-response.ts";
import { createPngBytes } from "../../fixtures/images.ts";

const roots: string[] = [];
const BASE = "tests/fixtures/flow-plan/m8-form-submit-state-machine";
const FILE_KEY = "abcdefgh";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function createCleanFlowPlan(root: string): Promise<string> {
  const dir = join(root, "fixtures");
  await mkdir(dir, { recursive: true });
  const raw = JSON.parse(await readFile(`${BASE}/flow-plan.json`, "utf8"));
  raw.interactions = raw.interactions.filter(
    (interaction: { id: string }) => interaction.id !== "inferred-submit",
  );
  raw.report.unresolvedInteractionCount = 0;
  const path = join(dir, "flow-plan-clean.json");
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);
  return path;
}

async function createNoExecutableFlowPlan(root: string): Promise<string> {
  const dir = join(root, "fixtures");
  await mkdir(dir, { recursive: true });
  const raw = JSON.parse(await readFile(`${BASE}/flow-plan.json`, "utf8"));
  raw.interactions = raw.interactions
    .filter((interaction: { id: string }) => interaction.id !== "inferred-submit")
    .map((interaction: Record<string, unknown>) => ({
      ...interaction,
      trigger: "click",
      intent: "set_state",
      value: "selected",
      stateMachineTransitionId: undefined,
      postconditions: [],
    }));
  raw.report.unresolvedInteractionCount = 0;
  raw.stateMachines = [];
  const path = join(dir, "flow-plan-no-executable.json");
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);
  return path;
}

function relative(path: string): string {
  return path.replace(`${process.cwd()}/`, "");
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function imageResponse(bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes).buffer, {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

function restrictedLiveSuccessFixture(): Record<string, unknown> {
  const fixture = createFigmaFileResponseFixture();
  const document = fixture.document as {
    children: Array<{ children: Array<{ id: string; children?: Array<Record<string, unknown>> }> }>;
  };
  const home = document.children[0]!.children[0]!;
  const imageNode = home.children?.find((node) => node.id === "1:3");
  if (imageNode) {
    imageNode.fills = [];
  }
  const continueNode = home.children?.find((node) => node.id === "1:4");
  if (continueNode) {
    continueNode.interactions = [
      {
        trigger: { type: "ON_CLICK" },
        actions: [
          {
            type: "NODE",
            navigation: "NAVIGATE",
            destinationId: "2:1",
          },
        ],
      },
    ];
  }
  return fixture;
}

describe("Product-M9 flow service", () => {
  it("runs a local trusted FlowPlan and writes Product-M9 summary", async () => {
    const root = "data/test-product-m9-service-local";
    roots.push(root);
    const flowPlanPath = await createCleanFlowPlan(root);

    const result = await runProductM9Flow({
      projectId: "demo-project",
      mode: "local",
      runId: "product-m9-service-local",
      flowPlanPath: relative(flowPlanPath),
      uiSpecPath: `${BASE}/ui-spec.json`,
      reportRoot: `${root}/reports`,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.error).toBeUndefined();
    expect(result.metrics.successfulFixtureIds?.length).toBeGreaterThan(0);
    expect(
      JSON.parse(
        await readFile(
          `${root}/reports/product-m9-service-local/summary.json`,
          "utf8",
        ),
      ).status,
    ).toBe("passed");
  });

  it("returns needs_confirmation for untrusted FlowPlan evidence", async () => {
    const root = "data/test-product-m9-service-confirmation";
    roots.push(root);

    const result = await runProductM9Flow({
      projectId: "demo-project",
      mode: "local",
      runId: "product-m9-service-confirmation",
      flowPlanPath: `${BASE}/flow-plan.json`,
      uiSpecPath: `${BASE}/ui-spec.json`,
      reportRoot: `${root}/reports`,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("partial");
    expect(result.error?.category).toBe("needs_confirmation");
    expect(result.error?.retryPolicy).toBe("manual_review");
  });

  it("returns partial_evidence when trusted FlowPlan has no executable fixtures", async () => {
    const root = "data/test-product-m9-service-no-executable";
    roots.push(root);
    const flowPlanPath = await createNoExecutableFlowPlan(root);

    const result = await runProductM9Flow({
      projectId: "demo-project",
      mode: "local",
      runId: "product-m9-service-no-executable",
      flowPlanPath: relative(flowPlanPath),
      uiSpecPath: `${BASE}/ui-spec.json`,
      reportRoot: `${root}/reports`,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("partial");
    expect(result.error?.category).toBe("partial_evidence");
    expect(result.metrics.successfulFixtureIds).toEqual([]);
    expect(result.metrics.failedFixtureIds).toEqual([]);
  });

  it("maps failed behavior validation to flow_execution_failed", async () => {
    const root = "data/test-product-m9-service-validation";
    roots.push(root);
    const flowPlanPath = await createCleanFlowPlan(root);

    const result = await runProductM9Flow(
      {
        projectId: "demo-project",
        mode: "local",
        runId: "product-m9-service-validation",
        flowPlanPath: relative(flowPlanPath),
        uiSpecPath: `${BASE}/ui-spec.json`,
        reportRoot: `${root}/reports`,
        runCompare: true,
      },
      {
        flowValidationRunner: async ({ runId, fixtureIds }) => ({
          schemaVersion: "1",
          runId,
          passed: false,
          resultCount: fixtureIds.length,
          failedCheckCount: 1,
          successfulFixtureIds: [],
          failedFixtureIds: [...fixtureIds],
          preSatisfiedExpectationCount: 0,
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error?.category).toBe("flow_execution_failed");
  });

  it("returns artifact_missing for absent local artifacts", async () => {
    const root = "data/test-product-m9-service-missing";
    roots.push(root);

    const result = await runProductM9Flow({
      projectId: "demo-project",
      mode: "local",
      runId: "product-m9-service-missing",
      flowPlanPath: `${root}/missing-flow-plan.json`,
      uiSpecPath: `${BASE}/ui-spec.json`,
      reportRoot: `${root}/reports`,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error?.category).toBe("artifact_missing");
  });

  it("loads restricted-live Figma artifacts through a mock REST success path", async () => {
    const root = "data/test-product-m9-service-figma-success";
    roots.push(root);
    const apiPaths: string[] = [];
    const requestedUrls: string[] = [];

    const result = await runProductM9Flow(
      {
        projectId: "demo-project",
        mode: "restricted-live",
        figmaUrl: `https://www.figma.com/design/${FILE_KEY}/demo?node-id=1-1`,
        gates: { allowFigmaNetwork: true },
        dataRoot: `${root}/data`,
        reportRoot: `${root}/reports`,
        runId: "product-m9-service-figma-success",
      },
      {
        env: {
          PRODUCT_M9_FIGMA_AUTHORIZED: "1",
          FIGMA_API_KEY: "private-token",
        },
        figmaMaxRetries: 0,
        figmaFetchImpl: async (input) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          requestedUrls.push(url.href);
          if (url.hostname === "api.figma.com") {
            apiPaths.push(url.pathname);
            if (url.pathname === `/v1/files/${FILE_KEY}/nodes`) {
              const ids = url.searchParams.get("ids") ?? "";
              const fixture = restrictedLiveSuccessFixture();
              const document = fixture.document as {
                children: Array<{ children: Array<Record<string, unknown>> }>;
              };
              const home = document.children[0]!.children[0]!;
              const settings = document.children[1]!.children[0]!;
              return jsonResponse({
                nodes: ids === "1:1"
                  ? {
                      "1:1": {
                        document: home,
                        components: fixture.components,
                        componentSets: fixture.componentSets,
                        styles: fixture.styles,
                      },
                    }
                  : {
                      "2:1": {
                        document: settings,
                        components: fixture.components,
                        componentSets: fixture.componentSets,
                        styles: fixture.styles,
                      },
                    },
              });
            }
            if (url.pathname === `/v1/images/${FILE_KEY}`) {
              const ids = url.searchParams.get("ids")?.split(",") ?? [];
              return jsonResponse({
                images: Object.fromEntries(
                  ids.map((id) => [
                    id,
                    `https://s3-alpha.figma.com/screenshots/${id.replaceAll(
                      ":",
                      "-",
                    )}.png`,
                  ]),
                ),
              });
            }
          }
          if (url.hostname !== "api.figma.com") {
            return imageResponse(createPngBytes(640, 480));
          }
          return new Response("unexpected", { status: 404 });
        },
      },
    );

    expect(result.mode).toBe("restricted-live");
    expect(result.status).toBe("partial");
    expect(result.error?.category).toBe("partial_evidence");
    expect(result.metrics.successfulFixtureIds?.length).toBeGreaterThan(0);
    expect(result.artifactRefs.designBundlePath).toBe(
      "data/projects/demo-project/figma/current.json",
    );
    expect(result.artifactRefs.uiSpecPath).toBe(
      "data/projects/demo-project/specs/current.json",
    );
    expect(result.artifactRefs.flowPlanPath).toBe(
      "data/projects/demo-project/flow/current.json",
    );
    expect(apiPaths).toContain(`/v1/files/${FILE_KEY}/nodes`);
    expect(apiPaths).toContain(`/v1/images/${FILE_KEY}`);
    expect(requestedUrls).toContain(
      "https://s3-alpha.figma.com/screenshots/1-1.png",
    );
  });

  it.each([
    [429, "figma_rate_limited"],
    [403, "figma_permission_denied"],
    [404, "figma_not_found"],
  ] as const)(
    "maps restricted-live Figma REST %s to %s",
    async (status, category) => {
      const root = `data/test-product-m9-service-figma-${status}`;
      roots.push(root);

      const result = await runProductM9Flow(
        {
          projectId: "demo-project",
          mode: "restricted-live",
          figmaUrl: "https://www.figma.com/design/abcdefgh/demo?node-id=1-1",
          gates: { allowFigmaNetwork: true },
          dataRoot: `${root}/data`,
          reportRoot: `${root}/reports`,
          runId: `product-m9-service-figma-${status}`,
        },
        {
          env: {
            PRODUCT_M9_FIGMA_AUTHORIZED: "1",
            FIGMA_API_KEY: "private-token",
          },
          figmaMaxRetries: 0,
          figmaFetchImpl: async () =>
            new Response("mock figma error", { status }),
        },
      );

      expect(result.ok).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error?.category).toBe(category);
    },
  );
});
