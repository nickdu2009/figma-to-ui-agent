import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runProductM9Flow } from "../../../src/runtime/product-m9-flow-service.ts";

const roots: string[] = [];
const BASE = "tests/fixtures/flow-plan/m8-form-submit-state-machine";

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

function relative(path: string): string {
  return path.replace(`${process.cwd()}/`, "");
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
