import { describe, expect, it } from "vitest";

import {
  parseFlowM9CommunitySampleManifest,
  selectFlowM9Samples,
  selectPrimaryFlowM9Samples,
} from "../../../src/flow-plan/m9-samples.ts";

const manifest = parseFlowM9CommunitySampleManifest({
  schemaVersion: "1",
  corpusId: "unit",
  samples: [
    {
      sampleId: "community-mobile-001",
      category: "mobile-app",
      title: "Fitness",
      accessStatus: "rest_readable_node_selected",
      designUrl: "https://www.figma.com/design/ABCDEFGH/Test",
      nodeId: "1:2",
      expectedViewport: "mobile",
    },
    {
      sampleId: "community-login-002",
      category: "login-register",
      title: "Login",
      accessStatus: "community_page_found",
      designUrl: null,
      nodeId: null,
      expectedViewport: "mobile",
    },
  ],
});

describe("Flow-M9 community sample manifest reader", () => {
  it("只把 rest_readable_node_selected 样本作为 primary", () => {
    expect(selectPrimaryFlowM9Samples(manifest)).toEqual([
      expect.objectContaining({
        sampleId: "community-mobile-001",
        locator: {
          designUrl: "https://www.figma.com/design/ABCDEFGH/Test",
          nodeId: "1:2",
        },
      }),
    ]);
  });

  it("显式选择不可读样本时保留 skip reason", () => {
    expect(
      selectFlowM9Samples(manifest, ["community-login-002"]),
    ).toEqual([
      expect.objectContaining({
        sampleId: "community-login-002",
        skipReason: "sample_not_rest_readable_node_selected",
      }),
    ]);
  });

  it("拒绝不存在的 sampleId", () => {
    expect(() =>
      selectFlowM9Samples(manifest, ["missing-sample"]),
    ).toThrow(/flow_m9_sample_not_found/);
  });
});
