import { describe, expect, it } from "vitest";

import {
  classifyFigmaRestEvidence,
  FIGMA_REST_POLICY_VERSION,
} from "../../../src/figma/capability-policy.ts";
import { capabilityCases } from "../../fixtures/figma/capability-cases.ts";

describe("classifyFigmaRestEvidence", () => {
  it("在核心能力和 Variables 均可用时通过", () => {
    expect(classifyFigmaRestEvidence(capabilityCases.allAvailable)).toEqual({
      policyVersion: FIGMA_REST_POLICY_VERSION,
      status: "passed",
      variablesCapability: "available",
      corePassed: true,
      m0Passed: true,
    });
  });

  it("Variables 不可用时不阻塞核心门", () => {
    expect(
      classifyFigmaRestEvidence(capabilityCases.variablesForbidden),
    ).toMatchObject({
      status: "passed_with_optional_variables_unavailable",
      variablesCapability: "unavailable_optional",
      corePassed: true,
      m0Passed: true,
    });
  });

  it("图片填充端点可读且数量为零时通过", () => {
    expect(
      classifyFigmaRestEvidence(capabilityCases.zeroImageFills),
    ).toMatchObject({
      status: "passed_with_optional_variables_unavailable",
      corePassed: true,
      m0Passed: true,
    });
  });

  it.each([
    ["节点不可读", capabilityCases.unreadableNodes],
    ["截图不是有效图片", capabilityCases.invalidScreenshotImage],
    ["图片填充端点不可读", capabilityCases.unreadableImageFills],
  ])("%s 时核心门失败", (_name, evidence) => {
    expect(classifyFigmaRestEvidence(evidence)).toMatchObject({
      status: "failed",
      corePassed: false,
      m0Passed: false,
    });
  });
});
