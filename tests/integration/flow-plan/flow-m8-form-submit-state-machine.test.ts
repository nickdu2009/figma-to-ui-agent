import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseFlowM8FormSubmitStateMachineReport,
} from "../../../src/flow-plan/m8-report.ts";
import { ProjectStore } from "../../../src/project-store/store.ts";
import { uiSpecDraftSchema } from "../../../src/ui-spec/schema.ts";
import {
  createMultipageFlowDesignBundleDraft,
  withFlowScreenshots,
} from "../../fixtures/flow-plan/multipage-flow.ts";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const executablePath = resolve(
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

async function loadJson(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      resolve("tests/fixtures/flow-plan/m8-form-submit-state-machine", name),
      "utf8",
    ),
  );
}

async function createReferencePng(background = "#fff"): Promise<Uint8Array> {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 320, height: 240 },
    });
    await page.setContent(
      `<main style="width:320px;height:240px;background:${background}"></main>`,
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

async function createProjectFixture(
  store: ProjectStore,
  projectId: string,
) {
  const homeScreenshotBytes = await createReferencePng("#fff");
  const successScreenshotBytes = await createReferencePng("#fefefe");
  const homeScreenshot = await store.saveLocalImage({
    projectId,
    kind: "screenshots",
    bytes: homeScreenshotBytes,
  });
  const successScreenshot = await store.saveLocalImage({
    projectId,
    kind: "screenshots",
    bytes: successScreenshotBytes,
  });
  const bundle = await store.saveDesignBundle({
    projectId,
    baseRevision: 0,
    draft: withFlowScreenshots(
      createMultipageFlowDesignBundleDraft(projectId),
      homeScreenshot,
      successScreenshot,
    ),
  });
  const uiSpec = await store.saveUISpec({
    projectId,
    baseRevision: 0,
    draft: uiSpecDraftSchema.parse(await loadJson("ui-spec.json")),
  });
  const flowPlan = await store.saveFlowPlan({
    projectId,
    baseRevision: 0,
    draft: await loadJson("flow-plan.json"),
  });
  return { bundle, uiSpec, flowPlan };
}

describe("Flow-M8 form_submit_state_machine runner", () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    );
  });

  it("转换 submit/state machine 并验证 select/radio 行为", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "flow-m8-"));
    roots.push(tempRoot);
    const dataRoot = join(tempRoot, "data");
    const reportRoot = join(tempRoot, "reports");
    const projectId = "demo-project";
    const store = new ProjectStore(dataRoot);
    const { uiSpec, flowPlan } = await createProjectFixture(store, projectId);

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "scripts/flow-m8-local.mjs",
        "--project-id",
        projectId,
        "--data-root",
        dataRoot,
        "--report-root",
        reportRoot,
        "--scenario",
        "tests/fixtures/flow-plan/m8-form-submit-state-machine/scenario.json",
        "--save-ui-spec",
        "--run-compare",
        "--run-id",
        "flow-m8-run",
        "--browser-executable-path",
        executablePath,
        "--comparison-json",
        JSON.stringify({
          maxDiffPixelRatio: 1,
          maxDiffPixels: 1_000_000,
          timeoutMs: 10_000,
        }),
      ],
      {
        cwd: resolve("."),
        timeout: 30_000,
      },
    );

    const report = parseFlowM8FormSubmitStateMachineReport(
      JSON.parse(stdout),
    );
    expect(report).toMatchObject({
      schemaVersion: "1",
      milestone: "Flow-M8",
      scope: "form_submit_state_machine",
      status: "passed",
      input: {
        uiSpecRevision: uiSpec.revision,
        flowPlanRevision: flowPlan.revision,
        savedUISpecRevision: 2,
      },
      counts: {
        trustedSubmitConverted: 2,
        userConfirmedConverted: 1,
        stateMachineTransitions: 2,
        selectRadioAssertions: 4,
        scenarioOnlyFixtures: 3,
      },
    });
    expect(report.validation?.successfulFixtureIds).toEqual(
      expect.arrayContaining([
        "flow-figma-submit-review-fixture",
        "flow-user-confirmed-finish-fixture",
        "m8-select-plan",
        "m8-radio-role",
      ]),
    );

    const savedReport = parseFlowM8FormSubmitStateMachineReport(
      JSON.parse(
        await readFile(
          join(reportRoot, "flow-m8-run", "summary.json"),
          "utf8",
        ),
      ),
    );
    expect(savedReport.counts.stateMachineTransitions).toBe(2);
    expect(await store.loadUISpec(projectId)).toMatchObject({
      revision: 2,
      sourceFlowPlanRevision: 1,
    });
  }, 30_000);

  it("scenario-only 返回 partial 且不保存 UISpec", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "flow-m8-partial-"));
    roots.push(tempRoot);
    const dataRoot = join(tempRoot, "data");
    const reportRoot = join(tempRoot, "reports");
    const projectId = "demo-project";
    const store = new ProjectStore(dataRoot);
    await createProjectFixture(store, projectId);
    await store.saveFlowPlan({
      projectId,
      baseRevision: 1,
      draft: {
        schemaVersion: "1",
        projectId,
        sourceDesignBundleRevision: 1,
        sourceUISpecRevision: 1,
        figmaInteractionSource: "absent",
        pages: [
          {
            id: "home",
            sourcePageId: "page-home",
            name: "登录",
            role: "entry",
            confidence: "high",
            reason: "fixture",
          },
        ],
        interactions: [],
        confirmationQuestions: [],
        confirmations: [],
        stateMachines: [],
        report: {
          unsupportedCount: 0,
          unresolvedInteractionCount: 0,
          convertedActionCount: 0,
          behaviorFixtureCount: 0,
          confirmationCount: 0,
        },
      },
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "scripts/flow-m8-local.mjs",
        "--project-id",
        projectId,
        "--data-root",
        dataRoot,
        "--report-root",
        reportRoot,
        "--scenario",
        "tests/fixtures/flow-plan/m8-form-submit-state-machine/scenario-only.json",
        "--save-ui-spec",
        "--run-id",
        "flow-m8-partial",
      ],
      {
        cwd: resolve("."),
        timeout: 30_000,
      },
    );

    const report = parseFlowM8FormSubmitStateMachineReport(
      JSON.parse(stdout),
    );
    expect(report.status).toBe("partial");
    expect(report.reasons).toEqual(
      expect.arrayContaining([
        "flow_m8_scenario_only_not_sufficient",
        "flow_m8_no_trusted_submit_or_two_transitions",
      ]),
    );
    expect(report.input.savedUISpecRevision).toBeUndefined();
    expect((await store.loadUISpec(projectId)).revision).toBe(1);
  }, 30_000);
});
