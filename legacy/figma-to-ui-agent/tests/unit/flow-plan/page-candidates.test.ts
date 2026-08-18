import { describe, expect, it } from "vitest";

import { identifyPageCandidates } from "../../../src/flow-plan/page-candidates.ts";
import {
  createMultipageFlowDesignBundleDraft,
  createStoredMultipageFlowDesignBundle,
  createStoredMultipageFlowUISpec,
} from "../../fixtures/flow-plan/multipage-flow.ts";

describe("identifyPageCandidates", () => {
  it("从多页面 DesignBundle 识别候选页面并映射 UISpec page id", () => {
    const result = identifyPageCandidates(
      createStoredMultipageFlowDesignBundle(),
      createStoredMultipageFlowUISpec(),
    );

    expect(result.satisfiesMultipage).toBe(true);
    expect(result.pages.map((page) => page.id)).toEqual([
      "home",
      "quote",
    ]);
    expect(result.pages[0]).toMatchObject({ role: "entry" });
  });

  it("单页面输入报告多页面验证条件不足", () => {
    const singlePage = {
      ...createMultipageFlowDesignBundleDraft(),
      revision: 1,
      pages: createMultipageFlowDesignBundleDraft().pages.slice(0, 1),
    };
    const result = identifyPageCandidates(singlePage);

    expect(result.satisfiesMultipage).toBe(false);
    expect(result.insufficientReason).toContain("不满足多页面");
  });
});
