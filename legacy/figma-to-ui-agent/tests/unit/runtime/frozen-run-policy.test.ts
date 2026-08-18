import { describe, expect, it } from "vitest";

import {
  assertFrozenRenderInput,
  assertFrozenUISpec,
  type FrozenRunPolicy,
  loadFrozenRunPolicy,
} from "../../../src/runtime/frozen-run-policy.ts";
import { createUISpecDraft } from "../../fixtures/contracts.ts";

const policy: FrozenRunPolicy = {
  schemaVersion: "1",
  baselineId: "a".repeat(64),
  viewports: [
    {
      id: "desktop",
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    {
      id: "mobile",
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
    },
  ],
  comparison: {
    maxDiffPixelRatio: 0.01,
    maxDiffPixels: 500,
    timeoutMs: 30_000,
  },
};

describe("M3 冻结运行策略", () => {
  it("未启用时保持 M1/M2 行为不变", () => {
    expect(loadFrozenRunPolicy({})).toBeUndefined();
    expect(() =>
      assertFrozenUISpec(undefined, createUISpecDraft()),
    ).not.toThrow();
  });

  it("拒绝损坏或过大的环境策略", () => {
    expect(() =>
      loadFrozenRunPolicy({
        M3_FROZEN_POLICY_JSON: "{",
      }),
    ).toThrow(/m3_frozen_policy_invalid/);
    expect(() =>
      loadFrozenRunPolicy({
        M3_FROZEN_POLICY_JSON: "x".repeat(64 * 1024 + 1),
      }),
    ).toThrow(/too_large/);
  });

  it("只接受完全一致的 UISpec 视口", () => {
    const uiSpec = createUISpecDraft();
    uiSpec.viewports = structuredClone(policy.viewports);
    expect(() => assertFrozenUISpec(policy, uiSpec)).not.toThrow();

    uiSpec.viewports[1]!.width += 1;
    expect(() => assertFrozenUISpec(policy, uiSpec)).toThrow(
      /ui_spec_viewports/,
    );
  });

  it("允许单画板校准只冻结一个视口", () => {
    const singleViewportPolicy: FrozenRunPolicy = {
      ...policy,
      viewports: [policy.viewports[0]!],
    };
    const uiSpec = createUISpecDraft();
    uiSpec.viewports = structuredClone(singleViewportPolicy.viewports);

    expect(() =>
      assertFrozenUISpec(singleViewportPolicy, uiSpec),
    ).not.toThrow();
    expect(() =>
      assertFrozenRenderInput(singleViewportPolicy, {
        schemaVersion: "1",
        projectId: "single-artboard",
        viewportIds: ["desktop"],
        comparison: structuredClone(singleViewportPolicy.comparison),
      }),
    ).not.toThrow();
  });

  it("只接受显式同序视口和完全一致的比较阈值", () => {
    const input = {
      schemaVersion: "1" as const,
      projectId: "blind-case",
      viewportIds: ["desktop", "mobile"],
      comparison: structuredClone(policy.comparison),
    };
    expect(() =>
      assertFrozenRenderInput(policy, input),
    ).not.toThrow();

    expect(() =>
      assertFrozenRenderInput(policy, {
        ...input,
        viewportIds: ["mobile", "desktop"],
      }),
    ).toThrow(/render_viewports/);
    expect(() =>
      assertFrozenRenderInput(policy, {
        ...input,
        comparison: {
          ...input.comparison,
          maxDiffPixels: input.comparison.maxDiffPixels + 1,
        },
      }),
    ).toThrow(/comparison/);
  });
});
