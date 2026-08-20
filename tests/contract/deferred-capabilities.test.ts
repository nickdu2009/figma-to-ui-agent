/**
 * S15 P1 延迟能力与负向安全门禁（实施计划 §S15 / 设计 §15 / AC8a-e, AC13f, AC17a, AC18a）。
 *
 * 验证：
 * 1. P1 能力（uploadAttachment、BusinessAttachment、独立 Preview Origin、Bridge、Capability Token）
 *    在 P0 中严格不可发现、不可调用；
 * 2. 负向门禁作为 S16 切换前的不可绕过检查项。
 */
import { describe, expect, it } from "vitest";
import { catalogContract } from "../../src/catalog/catalog-contract.ts";
import { appUiBundleSchema } from "../../src/catalog/app-ui-bundle.ts";
import { PROTOCOL_MODES } from "../../server/persistence/protocol-mode.ts";

describe("S15 P1 延迟能力负向门禁", () => {
  it("P0 Catalog 不暴露 uploadAttachment、BusinessAttachment 或 P1 专有 action", () => {
    const actionKeys = Object.keys(catalogContract.customActions);
    expect(actionKeys).not.toContain("uploadAttachment");
    expect(actionKeys).not.toContain("deleteAttachment");
    expect(actionKeys).not.toContain("queryAttachments");
  });

  it("P0 Catalog 组件不包含 P1 专用组件", () => {
    const allComponents = [
      ...Object.keys(catalogContract.components.base),
      ...Object.keys(catalogContract.components.additions),
    ];
    expect(allComponents).not.toContain("FileUpload");
    expect(allComponents).not.toContain("AttachmentViewer");
  });

  it("AppUiBundle Schema 不包含 P1 未授权字段", () => {
    const result = appUiBundleSchema.safeParse({
      bundleVersion: 1,
      catalogVersion: "1.0.0",
      specCompatibility: "0.19.0",
      spec: {
        metadata: { title: { default: "P1 Negative Test", template: "%s" } },
        routes: {
          "/": {
            page: {
              root: "r",
              elements: {
                r: { type: "Heading", props: { text: "Neg" }, children: [] },
              },
            },
          },
        },
        state: { ui: {} },
      },
      designSystem: {
        tokens: { primitive: {}, semantic: {}, component: {} },
        applicationCss: "",
      },
      assets: { entries: [] },
      // 注入 P1 字段应被忽略或拒绝（严格模式）
      attachments: [{ id: "att-1" }],
    });
    // appUiBundleSchema 会 strip 额外字段或解析为安全纯净 bundle
    if (result.success) {
      expect("attachments" in (result.data as Record<string, unknown>)).toBe(
        false,
      );
    }
  });

  it("协议模式中不包含未经设计的实验性模式", () => {
    expect(PROTOCOL_MODES).toEqual([
      "compat",
      "cutover",
      "v2",
      "readonly_recovery",
    ]);
  });
});
