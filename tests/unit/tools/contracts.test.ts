import { describe, expect, it } from "vitest";

import {
  inspectFigmaInputSchema,
  inspectFigmaOutputSchema,
  inspectFigmaParameters,
  loadUISpecParameters,
  loadUISpecOutputSchema,
  renderAndCompareOutputSchema,
  renderAndCompareParameters,
  saveUISpecInputSchema,
  saveUISpecOutputSchema,
  saveUISpecParameters,
  unsupportedFeatureSchema,
} from "../../../src/tools/contracts.ts";
import {
  createUISpecDraft,
} from "../../fixtures/contracts.ts";

const FLOW_URL =
  "https://www.figma.com/design/L8H9R9GfDn30yx5bPOmuaH/Flow-test?node-id=0-1";

describe("四工具 Zod 契约", () => {
  it("InspectFigmaInput 要求项目并校验 URL/目标冲突", () => {
    expect(
      inspectFigmaInputSchema.parse({
        schemaVersion: "1",
        projectId: "demo-project",
        figmaUrl: FLOW_URL,
        targetNodes: ["0:1", "12:34"],
        viewports: [
          {
            name: "desktop",
            width: 1440,
            height: 900,
            deviceScaleFactor: 1,
          },
        ],
        behaviorNotes: ["点击继续后保持在首页"],
      }),
    ).toMatchObject({ projectId: "demo-project" });

    expect(() =>
      inspectFigmaInputSchema.parse({
        schemaVersion: "1",
        figmaUrl: FLOW_URL,
      }),
    ).toThrow();
    expect(() =>
      inspectFigmaInputSchema.parse({
        schemaVersion: "1",
        projectId: "demo-project",
        figmaUrl: FLOW_URL,
        targetNodes: ["12:34"],
      }),
    ).toThrow("URL node-id 与 targetNodes 冲突");
  });

  it("save_ui_spec 校验完整草稿和项目一致性", () => {
    expect(
      saveUISpecInputSchema.parse({
        schemaVersion: "1",
        projectId: "demo-project",
        uiSpec: createUISpecDraft(),
        baseRevision: 0,
        reason: "初始生成",
      }),
    ).toMatchObject({ baseRevision: 0 });

    expect(() =>
      saveUISpecInputSchema.parse({
        schemaVersion: "1",
        projectId: "other-project",
        uiSpec: createUISpecDraft(),
        baseRevision: 0,
        reason: "错误项目",
      }),
    ).toThrow("工具输入与 UISpec 的 projectId 不一致");
  });

  it("inspect_figma 接受 FlowPlan 确认输入并输出结构化摘要", () => {
    expect(
      inspectFigmaInputSchema.parse({
        schemaVersion: "1",
        projectId: "demo-project",
        figmaUrl: FLOW_URL,
        flowConfirmations: [
          {
            questionId: "confirm-continue",
            value: "target:quote",
            reason: "用户确认",
          },
          {
            questionId: "confirm-dialog",
            answer: "static",
          },
        ],
      }).flowConfirmations,
    ).toEqual([
      {
        questionId: "confirm-continue",
        value: "target:quote",
        reason: "用户确认",
      },
      {
        questionId: "confirm-dialog",
        value: "static",
      },
    ]);

    expect(
      inspectFigmaOutputSchema.parse({
        schemaVersion: "1",
        projectId: "demo-project",
        designBundleRevision: 1,
        pages: [],
        variables: {
          status: "unavailable_optional",
          reasonCode: "plan_limited",
        },
        warnings: [],
        flowPlanRevision: 2,
        flowPlanSummary: {
          interactionCount: 2,
          confirmationQuestionCount: 1,
          confirmationCount: 1,
          bySource: {
            figma: 1,
            inferred: 0,
            user_confirmed: 1,
            missing: 0,
          },
          unsupportedCount: 0,
          unresolvedInteractionCount: 0,
          convertedActionCount: 1,
          behaviorFixtureCount: 1,
        },
        confirmationQuestions: [
          {
            id: "confirm-continue",
            interactionId: "continue-to-quote",
            question: "继续按钮是否跳转报价页？",
            options: [
              {
                label: "跳转报价页",
                value: "target:quote",
              },
            ],
            required: true,
          },
        ],
        unresolvedInteractionCount: 0,
      }),
    ).toMatchObject({
      flowPlanRevision: 2,
      unresolvedInteractionCount: 0,
    });
  });

  it("save_ui_spec 输出兼容 optional unsupportedFeatures", () => {
    const valid = {
      schemaVersion: "1",
      projectId: "demo-project",
      revision: 1,
      validation: {
        schemaValid: true,
        referencesValid: true,
        warningCount: 0,
      },
    };
    expect(saveUISpecOutputSchema.parse(valid)).toEqual(valid);
    expect(
      saveUISpecOutputSchema.parse({
        ...valid,
        unsupportedFeatures: [
          {
            code: "full_page_screenshot_fallback_rejected",
            severity: "must_support",
            evidenceSource: "schema_limit",
            uiSpecNodeRefs: ["screenshot"],
            impact: ["interaction", "accessibility"],
            recommendedAction: "extend_renderer",
          },
        ],
      }).unsupportedFeatures,
    ).toHaveLength(1);
  });

  it("load_ui_spec 输出包装必须与 UISpec 一致", () => {
    const uiSpec = {
      ...createUISpecDraft(),
      revision: 1,
    };
    expect(
      loadUISpecOutputSchema.parse({
        schemaVersion: "1",
        projectId: "demo-project",
        revision: 1,
        uiSpec,
      }),
    ).toMatchObject({ revision: 1 });
    expect(() =>
      loadUISpecOutputSchema.parse({
        schemaVersion: "1",
        projectId: "demo-project",
        revision: 2,
        uiSpec,
      }),
    ).toThrow("返回包装与 UISpec 的项目或修订不一致");
  });

  it("render_and_compare 输出只接受 localhost 和项目内产物", () => {
    const valid = {
      schemaVersion: "1",
      projectId: "demo-project",
      runId: "run-1",
      previewUrl: "http://127.0.0.1:4173/",
      passed: true,
      results: [
        {
          pageId: "home",
          viewportId: "desktop",
          checks: [{ kind: "visual", passed: true }],
          expectedImage: "runs/run-1/screenshots/expected.png",
          actualImage: "runs/run-1/screenshots/actual.png",
          diffPixelCount: 0,
          diffPixelRatio: 0,
        },
      ],
    };
    expect(renderAndCompareOutputSchema.parse(valid)).toEqual(valid);
    expect(() =>
      renderAndCompareOutputSchema.parse({
        ...valid,
        previewUrl: "https://example.com/",
      }),
    ).toThrow();
    expect(() =>
      renderAndCompareOutputSchema.parse({
        ...valid,
        results: [
          {
            ...valid.results[0],
            actualImage: "../outside.png",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      renderAndCompareOutputSchema.parse({
        ...valid,
        passed: false,
      }),
    ).toThrow("总体结果必须与所有检查结果一致");
    expect(
      renderAndCompareOutputSchema.parse({
        ...valid,
        unsupportedFeatures: [
          {
            code: "missing_click_target",
            severity: "missing_behavior_notes",
            evidenceSource: "validation_artifact",
            figmaNodeRefs: ["2:2"],
            impact: ["behavior"],
            recommendedAction: "request_behavior_notes",
          },
        ],
      }).unsupportedFeatures,
    ).toHaveLength(1);
  });

  it("unsupportedFeature 使用稳定分类和证据来源", () => {
    expect(
      unsupportedFeatureSchema.parse({
        code: "unsupported_blend_mode",
        severity: "fallback_ok",
        evidenceSource: "renderer_limit",
        figmaNodeRefs: ["2:3"],
        uiSpecNodeRefs: ["hero-art"],
        impact: ["visual"],
        recommendedAction: "allow_local_fallback",
      }),
    ).toMatchObject({ code: "unsupported_blend_mode" });
    expect(() =>
      unsupportedFeatureSchema.parse({
        code: "Bad Code",
        severity: "unknown",
        evidenceSource: "renderer_limit",
        impact: ["visual"],
        recommendedAction: "defer",
      }),
    ).toThrow();
  });
});

describe("Extension provider 参数 Schema", () => {
  it("与正式四工具输入面保持一致", () => {
    expect(inspectFigmaParameters.required).toContain("projectId");
    expect(inspectFigmaParameters.properties.figmaUrl).toMatchObject({
      description: expect.stringContaining("逐字符复制"),
    });
    expect(inspectFigmaParameters.properties.targetNodes).toMatchObject({
      description: expect.stringContaining("仅当用户明确提供目标节点"),
    });
    expect(inspectFigmaParameters.properties).toHaveProperty(
      "flowConfirmations",
    );
    expect(loadUISpecParameters.properties).not.toHaveProperty("pageId");
    expect(saveUISpecParameters.properties.uiSpec).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(saveUISpecParameters.properties.uiSpec).not.toHaveProperty(
      "$schema",
    );
    expect(renderAndCompareParameters.properties).toHaveProperty(
      "behaviorFixtureIds",
    );
    expect(renderAndCompareParameters.properties).not.toHaveProperty(
      "interactionCases",
    );
  });
});
