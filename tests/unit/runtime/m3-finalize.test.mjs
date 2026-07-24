import { describe, expect, it } from "vitest";

import { evaluateM3Coverage } from "../../../scripts/finalize-m3.mjs";

function caseEvidence(variablesCapability, featureEvidence) {
  return {
    manifest: {},
    result: {
      variablesCapability,
      featureEvidence: {
        pageCount: 1,
        componentCount: 0,
        imageAssetCount: 0,
        fullPageScreenshotFallback: false,
        interactiveNodeCount: 0,
        textNodeCount: 1,
        screenshotFallbackKind: "none",
        screenshotFallbackNodeCount: 0,
        autoLayoutNodeCount: 0,
        boundVariableRefCount: 0,
        unsupportedNodeCount: 0,
        ...featureEvidence,
      },
    },
  };
}

const freeze = {
  controlledSurface: {
    fixedViewports: [{ id: "landingpage" }],
    variablesContractFixture: {
      nonLive: true,
      fullVariablesCovered: true,
      boundVariablesFallbackCovered: true,
    },
  },
};

describe("M3 三次盲测覆盖汇总", () => {
  it("三个输入合计覆盖正式盲测矩阵", () => {
    const cases = [
      caseEvidence(
        {
          status: "unavailable_optional",
          reasonCode: "unknown",
        },
        { pageCount: 2 },
      ),
      caseEvidence(
        {
          status: "unavailable_optional",
          reasonCode: "unknown",
        },
        {
          boundVariableRefCount: 2,
          componentCount: 1,
        },
      ),
      caseEvidence(
        {
          status: "unavailable_optional",
          reasonCode: "unknown",
        },
        {
          imageAssetCount: 1,
          interactiveNodeCount: 1,
          autoLayoutNodeCount: 1,
        },
      ),
    ];

    expect(evaluateM3Coverage(cases, freeze)).toEqual({
      noVariables: true,
      bindingsWithoutFullVariables: true,
      fullVariablesOrExplicitNonLiveContractFixture: true,
      multiplePages: true,
      frozenViewports: true,
      components: true,
      images: true,
      complexAutoLayout: true,
      structuralEvidence: true,
      structuredText: true,
      noFullPageScreenshotFallback: true,
    });
  });

  it("不把未覆盖能力误判为通过", () => {
    const cases = [
      caseEvidence(
        {
          status: "available",
          variableCount: 1,
          collectionCount: 1,
        },
        {},
      ),
    ];
    const freezeWithoutFallback = {
      controlledSurface: {
        ...freeze.controlledSurface,
        variablesContractFixture: {
          nonLive: true,
          fullVariablesCovered: true,
          boundVariablesFallbackCovered: false,
        },
      },
    };
    const coverage = evaluateM3Coverage(cases, freezeWithoutFallback);

    expect(coverage.fullVariablesOrExplicitNonLiveContractFixture).toBe(
      true,
    );
    expect(coverage.noVariables).toBe(false);
    expect(coverage.bindingsWithoutFullVariables).toBe(false);
    expect(coverage.components).toBe(false);
    expect(coverage.images).toBe(false);
    expect(coverage.complexAutoLayout).toBe(false);
    expect(coverage.structuralEvidence).toBe(true);
    expect(coverage.structuredText).toBe(true);
    expect(coverage.noFullPageScreenshotFallback).toBe(true);
  });

  it("允许非 live 契约夹具覆盖 boundVariables fallback", () => {
    const cases = [
      caseEvidence(
        {
          status: "unavailable_optional",
          reasonCode: "unknown",
        },
        {},
      ),
    ];

    const coverage = evaluateM3Coverage(cases, freeze);

    expect(coverage.bindingsWithoutFullVariables).toBe(true);
  });

  it("缺少结构化指标时不允许最终验收", () => {
    const caseWithoutStructuralEvidence = caseEvidence(
      {
        status: "unavailable_optional",
        reasonCode: "unknown",
      },
      {},
    );
    delete caseWithoutStructuralEvidence.result.featureEvidence
      .fullPageScreenshotFallback;
    delete caseWithoutStructuralEvidence.result.featureEvidence
      .interactiveNodeCount;
    delete caseWithoutStructuralEvidence.result.featureEvidence
      .textNodeCount;
    delete caseWithoutStructuralEvidence.result.featureEvidence
      .screenshotFallbackKind;

    const coverage = evaluateM3Coverage(
      [caseWithoutStructuralEvidence],
      freeze,
    );

    expect(coverage.structuralEvidence).toBe(false);
    expect(coverage.noFullPageScreenshotFallback).toBe(false);
  });

  it("视觉通过但存在整页截图 fallback 时不允许最终验收", () => {
    const coverage = evaluateM3Coverage(
      [
        caseEvidence(
          {
            status: "unavailable_optional",
            reasonCode: "unknown",
          },
          {
            fullPageScreenshotFallback: true,
            textNodeCount: 0,
            screenshotFallbackKind: "rejected",
            screenshotFallbackNodeCount: 1,
          },
        ),
      ],
      freeze,
    );

    expect(coverage.structuralEvidence).toBe(true);
    expect(coverage.structuredText).toBe(false);
    expect(coverage.noFullPageScreenshotFallback).toBe(false);
  });
});
