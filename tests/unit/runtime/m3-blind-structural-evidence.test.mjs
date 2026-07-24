import { describe, expect, it } from "vitest";

import { collectUISpecStructuralEvidence } from "../../../scripts/run-m3-blind.mjs";
import {
  createRootScreenshotUISpecDraft,
  createUISpecDraft,
  FIXTURE_SCREENSHOT_PATH,
} from "../../fixtures/contracts.ts";

describe("M3 blind 结构化证据", () => {
  it("识别 root 单截图 fallback", () => {
    const evidence = collectUISpecStructuralEvidence(
      createRootScreenshotUISpecDraft("blind-case", 1),
    );

    expect(evidence).toMatchObject({
      fullPageScreenshotFallback: true,
      interactiveNodeCount: 0,
      textNodeCount: 0,
      screenshotFallbackKind: "rejected",
      screenshotFallbackNodeCount: 1,
    });
  });

  it("允许带结构化节点的局部截图 fallback", () => {
    const draft = createUISpecDraft("blind-case");
    draft.nodes.push({
      id: "decor",
      kind: "image",
      assetRef: FIXTURE_SCREENSHOT_PATH,
      alt: "局部装饰",
      fit: "contain",
      designValueRefs: [],
    });
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("decor");
    }

    const evidence = collectUISpecStructuralEvidence(draft);

    expect(evidence).toMatchObject({
      fullPageScreenshotFallback: false,
      interactiveNodeCount: 1,
      textNodeCount: 1,
      screenshotFallbackKind: "allowed-local",
      screenshotFallbackNodeCount: 1,
    });
  });

  it("把新增 P1 交互节点计入 interactiveNodeCount", () => {
    const draft = createUISpecDraft("blind-case");
    draft.nodes.push(
      { id: "link", kind: "link", label: "条款", designValueRefs: [] },
      { id: "radio", kind: "radio", label: "A", stateKey: "x", value: "a", designValueRefs: [] },
      { id: "switch", kind: "switch", label: "S", stateKey: "y", designValueRefs: [] },
      { id: "select", kind: "select", label: "C", stateKey: "z", options: [{ value: "a", label: "A" }], designValueRefs: [] },
      { id: "textarea", kind: "textarea", label: "T", stateKey: "w", designValueRefs: [] },
      { id: "tabs", kind: "tabs", stateKey: "tab", tabs: [{ value: "a", label: "A", childIds: [] }], designValueRefs: [] },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("link", "radio", "switch", "select", "textarea", "tabs");
    }

    const evidence = collectUISpecStructuralEvidence(draft);
    expect(evidence.interactiveNodeCount).toBe(7);
  });
});
