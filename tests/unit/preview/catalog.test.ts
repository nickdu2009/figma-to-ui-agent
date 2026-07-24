import { describe, expect, it } from "vitest";

import { previewCatalog } from "../../../src/preview/catalog.ts";

function baseProps(nodeId: string) {
  return {
    nodeId,
    designValueRefs: [],
  };
}

function validSpec(rootType: string, rootProps: Record<string, unknown>) {
  return {
    root: "root",
    elements: {
      root: {
        type: rootType,
        props: { ...baseProps("root"), ...rootProps },
        children: [],
        visible: true,
      },
    },
    state: {},
  };
}

describe("Preview Catalog", () => {
  it("接受 P1 表单组件", () => {
    const components = [
      ["Link", { label: "条款", disabled: false }],
      [
        "Radio",
        { label: "选项", value: "a", stateKey: "choice", disabled: false },
      ],
      ["Switch", { label: "开关", checked: false, disabled: false }],
      [
        "Select",
        {
          label: "选择",
          value: "a",
          options: [{ value: "a", label: "A" }],
          placeholder: null,
          disabled: false,
        },
      ],
      [
        "Textarea",
        { label: "备注", value: "", placeholder: null, disabled: false },
      ],
      [
        "FormField",
        {
          label: "字段",
          helpText: null,
          errorText: null,
          required: false,
        },
      ],
    ] as const;
    for (const [type, props] of components) {
      const result = previewCatalog.validate(
        validSpec(type, props as Record<string, unknown>),
      );
      expect(result.success).toBe(true);
    }
  });

  it("接受 P1 内容与导航组件", () => {
    const components = [
      ["Icon", { src: "/a.png", alt: "图标", decorative: false }],
      ["Spacer", { width: 16, height: null }],
      ["Card", {}],
      ["List", { ordered: false }],
      ["ListItem", {}],
      ["Badge", { label: "新", tone: "success" }],
      ["Avatar", { src: null, initials: "JD", alt: "头像" }],
      [
        "Tabs",
        {
          selectedTab: "a",
          tabs: [{ value: "a", label: "A", childIds: [] }],
        },
      ],
      ["Nav", { orientation: "horizontal" }],
    ] as const;
    for (const [type, props] of components) {
      const result = previewCatalog.validate(
        validSpec(type, props as Record<string, unknown>),
      );
      expect(result.success).toBe(true);
    }
  });

  it("拒绝越界 enum 和非法 props", () => {
    expect(
      previewCatalog.data.components.Badge.props.safeParse({
        ...baseProps("x"),
        label: "新",
        tone: "unknown",
      }).success,
    ).toBe(false);
    expect(
      previewCatalog.data.components.Nav.props.safeParse({
        ...baseProps("x"),
        orientation: "diagonal",
      }).success,
    ).toBe(false);
    expect(
      previewCatalog.data.components.Select.props.safeParse({
        ...baseProps("x"),
        label: "选择",
        value: "a",
        options: [],
        placeholder: null,
        disabled: false,
      }).success,
    ).toBe(false);
  });
});
