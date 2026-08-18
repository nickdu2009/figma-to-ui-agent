import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectStore } from "../../../src/project-store/store.ts";
import {
  runM7E2EFlow,
} from "../../../src/runtime/e2e-flow-service.ts";
import { createM5StaticDesignBundleDraft } from "../../fixtures/static-generation/m5-static-fixture.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function createFixture(input: {
  root: string;
  projectId: string;
}): Promise<number> {
  const dataRoot = join(input.root, "data");
  const store = new ProjectStore(dataRoot);
  await store.initializeProject(input.projectId);
  const saved = await store.saveDesignBundle({
    projectId: input.projectId,
    baseRevision: 0,
    draft: createM5StaticDesignBundleDraft(input.projectId),
  });
  return saved.revision;
}

describe("M7 E2E flow service", () => {
  it("runs local flow with explicit DesignBundle revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "m7-flow-"));
    roots.push(root);
    const projectId = "m7-local-demo";
    const revision = await createFixture({ root, projectId });

    const result = await runM7E2EFlow(
      {
        projectId,
        mode: "local",
        designBundleRevision: revision,
        dataRoot: join(root, "data"),
        reportRoot: join(root, "reports"),
        runId: "m7-local-run",
      },
      { cwd: root },
    );

    expect(result.ok).toBe(true);
    expect(result.input.designBundleRevision).toBe(revision);
    expect(result.input.designBundleRevisionSource).toBe("explicit");
    expect(result.artifacts.uiSpecRef).toContain("uiSpec");
    expect(result.validation?.status).toBe("skipped");
    expect(
      JSON.parse(
        await readFile(
          join(root, "reports", "m7-local-run", "summary.json"),
          "utf8",
        ),
      ).runId,
    ).toBe("m7-local-run");
  });

  it("marks local current revision explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "m7-flow-current-"));
    roots.push(root);
    const projectId = "m7-current-demo";
    await createFixture({ root, projectId });

    const result = await runM7E2EFlow(
      {
        projectId,
        mode: "local",
        dataRoot: join(root, "data"),
        reportRoot: join(root, "reports"),
        runId: "m7-current-run",
      },
      { cwd: root },
    );

    expect(result.ok).toBe(true);
    expect(result.input.designBundleRevisionSource).toBe("current");
  });

  it("fails closed when restricted-live lacks Figma network gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "m7-flow-gate-"));
    roots.push(root);

    const result = await runM7E2EFlow(
      {
        projectId: "m7-gate-demo",
        mode: "restricted-live",
        figmaUrl:
          "https://www.figma.com/design/ScI7ZTAXdjaqUDG1LeRnqd/LoginUIConcept--Community-?node-id=2-2",
        dataRoot: join(root, "data"),
        reportRoot: join(root, "reports"),
        runId: "m7-gate-run",
      },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe("auth_missing");
    expect(result.nextAction).toMatch(/allowFigmaNetwork|local/);
  });

  it("reports missing token after restricted-live network gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "m7-flow-token-"));
    roots.push(root);

    const result = await runM7E2EFlow(
      {
        projectId: "m7-token-demo",
        mode: "restricted-live",
        figmaUrl:
          "https://www.figma.com/design/ScI7ZTAXdjaqUDG1LeRnqd/LoginUIConcept--Community-?node-id=2-2",
        gates: {
          allowFigmaNetwork: true,
        },
        dataRoot: join(root, "data"),
        reportRoot: join(root, "reports"),
        runId: "m7-token-run",
      },
      { cwd: root, env: {} },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe("auth_missing");
    expect(result.error?.message).toMatch(/FIGMA_API_KEY/);
  });

  it("maps mocked Figma 429 to stable figma_rate_limited", async () => {
    const root = await mkdtemp(join(tmpdir(), "m7-flow-429-"));
    roots.push(root);
    const rateLogs: unknown[] = [];

    const result = await runM7E2EFlow(
      {
        projectId: "m7-rate-demo",
        mode: "restricted-live",
        fileKey: "ScI7ZTAXdjaqUDG1LeRnqd",
        nodeId: "2-2",
        gates: {
          allowFigmaNetwork: true,
        },
        dataRoot: join(root, "data"),
        reportRoot: join(root, "reports"),
        runId: "m7-rate-run",
      },
      {
        cwd: root,
        env: {
          FIGMA_API_KEY: "figd_testtoken",
        },
        figmaFetchImpl: async () =>
          new Response("{}", {
            status: 429,
            headers: {
              "retry-after": "0",
              "x-figma-plan-tier": "starter",
              "x-figma-rate-limit-type": "file",
            },
          }),
        figmaMaxRetries: 0,
        figmaSleep: async () => {},
        rateLimitLogger: (event) => rateLogs.push(event),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.input.fileKey).toBe("ScI7ZTAXdjaqUDG1LeRnqd");
    expect(result.input.nodeId).toBe("2:2");
    expect(result.error?.category).toBe("figma_rate_limited");
    expect(rateLogs).toHaveLength(1);
  });

  it("returns stable input_invalid for bad input", async () => {
    const root = await mkdtemp(join(tmpdir(), "m7-flow-invalid-"));
    roots.push(root);

    const result = await runM7E2EFlow(
      {
        projectId: "Invalid_Project",
        mode: "remote",
        reportRoot: join(root, "reports"),
        runId: "m7-invalid-run",
      },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(result.projectId).toBeUndefined();
    expect(result.error?.category).toBe("input_invalid");
  });
});
