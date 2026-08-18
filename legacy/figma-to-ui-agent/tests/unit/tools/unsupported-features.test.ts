import { describe, expect, it } from "vitest";

import { collectUnsupportedFeatures } from "../../../src/tools/unsupported-features.ts";
import {
  createRootScreenshotUISpecDraft,
  createUISpecDraft,
  FIXTURE_SCREENSHOT_PATH,
} from "../../fixtures/contracts.ts";

describe("collectUnsupportedFeatures", () => {
  it("区分整页截图拒绝、局部截图 fallback 和缺少行为说明", () => {
    const rootScreenshot = createRootScreenshotUISpecDraft("case", 1);
    const rejected = collectUnsupportedFeatures(
      rootScreenshot,
      "validation_artifact",
    );
    expect(rejected).toContainEqual(
      expect.objectContaining({
        code: "full_page_screenshot_fallback_rejected",
        severity: "must_support",
      }),
    );

    const localFallback = createUISpecDraft("case");
    localFallback.nodes.push({
      id: "decor",
      kind: "image",
      assetRef: FIXTURE_SCREENSHOT_PATH,
      alt: "局部装饰",
      fit: "contain",
      designValueRefs: [],
    });
    const root = localFallback.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("decor");
    }
    const features = collectUnsupportedFeatures(
      localFallback,
      "schema_limit",
    );
    expect(features).toContainEqual(
      expect.objectContaining({
        code: "screenshot_fallback_used",
        severity: "fallback_ok",
        recommendedAction: "allow_local_fallback",
      }),
    );
    expect(
      features.some(
        (feature) => feature.code === "full_page_screenshot_fallback_rejected",
      ),
    ).toBe(false);

    const missingNotes = createUISpecDraft("case");
    const withNotes = collectUnsupportedFeatures(missingNotes, "inspect_warning", {
      behaviorNotes: ["说明"],
    });
    expect(
      withNotes.some((feature) => feature.code === "missing_behavior_notes"),
    ).toBe(false);

    const withoutNotes = collectUnsupportedFeatures(missingNotes, "inspect_warning", {
      behaviorNotes: [],
    });
    expect(withoutNotes).toContainEqual(
      expect.objectContaining({
        code: "missing_behavior_notes",
        severity: "missing_behavior_notes",
        recommendedAction: "request_behavior_notes",
      }),
    );
  });

  it("检测 overlay 与交互控件碰撞", () => {
    const uiSpec = createUISpecDraft("case");
    uiSpec.nodes.push(
      {
        id: "overlay",
        kind: "pixel_overlay",
        assetRef: FIXTURE_SCREENSHOT_PATH,
        alt: "覆盖层",
        width: 100,
        height: 50,
        frame: { x: 10, y: 10, width: 100, height: 50 },
        style: {
          pointerEvents: "auto",
        },
        childIds: [],
        designValueRefs: [],
      },
      {
        id: "submit",
        kind: "button",
        label: "提交",
        variant: "primary",
        frame: { x: 80, y: 30, width: 80, height: 40 },
        designValueRefs: [],
      },
    );
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("overlay", "submit");
    }
    const features = collectUnsupportedFeatures(
      uiSpec,
      "validation_artifact",
    );
    expect(features).toContainEqual(
      expect.objectContaining({
        code: "renderer_limit_overlay_collision",
        severity: "must_support",
        recommendedAction: "extend_renderer",
        uiSpecNodeRefs: ["overlay"],
      }),
    );
  });

  it("overlay 默认不接管指针事件时不报告交互碰撞", () => {
    const uiSpec = createUISpecDraft("case");
    uiSpec.nodes.push(
      {
        id: "overlay",
        kind: "pixel_overlay",
        assetRef: FIXTURE_SCREENSHOT_PATH,
        alt: "覆盖层",
        width: 100,
        height: 50,
        frame: { x: 10, y: 10, width: 100, height: 50 },
        childIds: [],
        designValueRefs: [],
      },
      {
        id: "submit",
        kind: "button",
        label: "提交",
        variant: "primary",
        frame: { x: 80, y: 30, width: 80, height: 40 },
        designValueRefs: [],
      },
    );
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("overlay", "submit");
    }

    const features = collectUnsupportedFeatures(
      uiSpec,
      "validation_artifact",
    );
    expect(
      features.some(
        (feature) => feature.code === "renderer_limit_overlay_collision",
      ),
    ).toBe(false);
  });

  it("overlay 明确位于交互控件后面时不报告碰撞", () => {
    const uiSpec = createUISpecDraft("case");
    uiSpec.nodes.push(
      {
        id: "decor",
        kind: "pixel_overlay",
        assetRef: FIXTURE_SCREENSHOT_PATH,
        alt: "装饰层",
        width: 100,
        height: 50,
        childIds: [],
        style: {
          position: "absolute",
          left: 10,
          top: 10,
          width: 100,
          height: 50,
          zIndex: 0,
        },
        designValueRefs: [],
      },
      {
        id: "submit",
        kind: "button",
        label: "提交",
        variant: "primary",
        frame: { x: 80, y: 30, width: 80, height: 40 },
        style: {
          position: "absolute",
          left: 80,
          top: 30,
          width: 80,
          height: 40,
          zIndex: 1,
        },
        designValueRefs: [],
      },
    );
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("decor", "submit");
    }

    const features = collectUnsupportedFeatures(
      uiSpec,
      "validation_artifact",
    );
    expect(
      features.some(
        (feature) => feature.code === "renderer_limit_overlay_collision",
      ),
    ).toBe(false);
    expect(features).toContainEqual(
      expect.objectContaining({
        code: "screenshot_fallback_used",
        severity: "fallback_ok",
        uiSpecNodeRefs: ["decor"],
      }),
    );
  });

  it("overlay 包含交互子节点时不报告碰撞", () => {
    const uiSpec = createUISpecDraft("case");
    uiSpec.nodes.push(
      {
        id: "overlay",
        kind: "pixel_overlay",
        assetRef: FIXTURE_SCREENSHOT_PATH,
        alt: "局部视觉层",
        width: 120,
        height: 80,
        frame: { x: 10, y: 10, width: 120, height: 80 },
        childIds: ["submit"],
        designValueRefs: [],
      },
      {
        id: "submit",
        kind: "button",
        label: "提交",
        variant: "primary",
        frame: { x: 20, y: 20, width: 80, height: 40 },
        designValueRefs: [],
      },
    );
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("overlay");
    }

    const features = collectUnsupportedFeatures(
      uiSpec,
      "validation_artifact",
    );
    expect(
      features.some(
        (feature) => feature.code === "renderer_limit_overlay_collision",
      ),
    ).toBe(false);
  });

  it("嵌套绝对定位控件按父层偏移计算碰撞", () => {
    const uiSpec = createUISpecDraft("case");
    uiSpec.nodes.push(
      {
        id: "decor",
        kind: "pixel_overlay",
        assetRef: FIXTURE_SCREENSHOT_PATH,
        alt: "装饰层",
        width: 100,
        height: 50,
        childIds: [],
        style: {
          position: "absolute",
          left: 0,
          top: 0,
          width: 100,
          height: 50,
        },
        designValueRefs: [],
      },
      {
        id: "panel",
        kind: "stack",
        direction: "vertical",
        childIds: ["submit"],
        style: {
          position: "absolute",
          left: 200,
          top: 0,
          width: 200,
          height: 100,
        },
        designValueRefs: [],
      },
      {
        id: "submit",
        kind: "button",
        label: "提交",
        variant: "primary",
        frame: { x: 20, y: 10, width: 80, height: 40 },
        style: {
          position: "absolute",
          left: 20,
          top: 10,
          width: 80,
          height: 40,
        },
        designValueRefs: [],
      },
    );
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("decor", "panel");
    }

    const features = collectUnsupportedFeatures(
      uiSpec,
      "validation_artifact",
    );
    expect(
      features.some(
        (feature) => feature.code === "renderer_limit_overlay_collision",
      ),
    ).toBe(false);
  });

  it("overlay 缺少 frame 时输出 residual assumption", () => {
    const uiSpec = createUISpecDraft("case");
    uiSpec.nodes.push({
      id: "overlay",
      kind: "pixel_overlay",
      assetRef: FIXTURE_SCREENSHOT_PATH,
      alt: "覆盖层",
      width: 100,
      height: 50,
      childIds: [],
      designValueRefs: [],
    });
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("overlay");
    }
    const features = collectUnsupportedFeatures(
      uiSpec,
      "validation_artifact",
    );
    expect(features).toContainEqual(
      expect.objectContaining({
        code: "residual_assumption_overlay_collision_unknown",
        severity: "defer",
        recommendedAction: "defer",
        uiSpecNodeRefs: ["overlay"],
      }),
    );
  });
});
