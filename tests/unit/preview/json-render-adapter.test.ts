import { describe, expect, it } from "vitest";

import {
  PreviewAdapterError,
  toPreviewJsonSpec,
} from "../../../src/preview/json-render-adapter.ts";
import { uiSpecSchema } from "../../../src/ui-spec/schema.ts";
import {
  FIXTURE_ASSET_PATH,
  createUISpecDraft,
} from "../../fixtures/contracts.ts";

describe("toPreviewJsonSpec", () => {
  it("只生成页面可达的受控 Catalog 元素、状态绑定和声明动作", () => {
    const uiSpec = uiSpecSchema.parse({
      ...createUISpecDraft(),
      revision: 1,
    });
    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
    });

    expect(preview.root).toBe("root");
    expect(Object.keys(preview.elements)).toEqual([
      "root",
      "title",
      "image",
      "continue",
    ]);
    expect(preview.elements.image).toMatchObject({
      type: "Image",
      props: {
        src: expect.stringMatching(/^\/project-image\/figma\/assets\//),
      },
    });
    expect(preview.elements.continue).toMatchObject({
      type: "Button",
      props: {
        disabled: false,
      },
      on: {
        press: {
          action: "dispatch",
          params: { actionId: "stay-home" },
        },
      },
    });
    expect(JSON.stringify(preview)).not.toContain("http");
    expect(JSON.stringify(preview)).not.toContain("<script");
    expect(JSON.stringify(preview)).not.toContain("style");
  });

  it("归一化三类禁用控件并移除禁用按钮动作", () => {
    const draft = createUISpecDraft();
    const button = draft.nodes.find(
      (node) => node.kind === "button",
    );
    if (button?.kind === "button") {
      button.disabled = true;
    }
    draft.state.push(
      {
        key: "email",
        valueType: "string",
        initialValue: "",
      },
      {
        key: "accepted",
        valueType: "boolean",
        initialValue: false,
      },
    );
    draft.nodes.push(
      {
        id: "email",
        kind: "input",
        label: "邮箱",
        stateKey: "email",
        inputType: "email",
        disabled: true,
        designValueRefs: [],
      },
      {
        id: "accepted",
        kind: "checkbox",
        label: "接受",
        stateKey: "accepted",
        disabled: true,
        designValueRefs: [],
      },
    );
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("email", "accepted");
    }
    const uiSpec = uiSpecSchema.parse({
      ...draft,
      revision: 1,
    });

    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
    });

    expect(preview.elements.continue).toMatchObject({
      type: "Button",
      props: { disabled: true },
    });
    expect(preview.elements.continue?.on).toBeUndefined();
    expect(preview.elements.email).toMatchObject({
      type: "Input",
      props: { disabled: true },
    });
    expect(preview.elements.accepted).toMatchObject({
      type: "Checkbox",
      props: { disabled: true },
    });
  });

  it("映射 button 图标资产和 pixel_overlay", () => {
    const draft = createUISpecDraft();
    const button = draft.nodes.find(
      (node) => node.kind === "button",
    );
    if (button?.kind === "button") {
      button.leadingIconAssetRef = FIXTURE_ASSET_PATH;
      button.trailingIconAssetRef = FIXTURE_ASSET_PATH;
    }
    const root = draft.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("overlay");
    }
    draft.nodes.push({
      id: "overlay",
      kind: "pixel_overlay",
      assetRef: FIXTURE_ASSET_PATH,
      alt: "装饰覆盖层",
      width: 320,
      height: 180,
      childIds: ["overlay-caption"],
      designValueRefs: [],
    });
    draft.nodes.push({
      id: "overlay-caption",
      kind: "text",
      text: "覆盖层内结构化文本",
      variant: "caption",
      designValueRefs: [],
    });
    const uiSpec = uiSpecSchema.parse({
      ...draft,
      revision: 1,
    });

    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
    });

    expect(preview.elements.continue).toMatchObject({
      type: "Button",
      props: {
        leadingIconSrc: expect.stringMatching(
          /^\/project-image\/figma\/assets\//,
        ),
        trailingIconSrc: expect.stringMatching(
          /^\/project-image\/figma\/assets\//,
        ),
      },
    });
    expect(preview.elements.overlay).toMatchObject({
      type: "PixelOverlay",
      props: {
        src: expect.stringMatching(/^\/project-image\/figma\/assets\//),
        width: 320,
        height: 180,
      },
      children: ["overlay-caption"],
    });
    expect(preview.elements["overlay-caption"]).toMatchObject({
      type: "Text",
    });
  });

  it("仅透传受控基础样式字段", () => {
    const draft = createUISpecDraft();
    const title = draft.nodes.find((node) => node.id === "title");
    if (title) {
      title.style = {
        textColor: "#123456",
        fontSize: 24,
        fontWeight: "bold",
        lineHeight: 1.25,
        backgroundColor: "#ffffff",
        borderRadius: 8,
        boxShadow: "sm",
        maxWidth: 320,
      };
    }
    const uiSpec = uiSpecSchema.parse({
      ...draft,
      revision: 1,
    });

    const preview = toPreviewJsonSpec(uiSpec, "home", {
      imageUrl: (path) => `/project-image/${path}`,
    });

    expect(preview.elements.title).toMatchObject({
      type: "Text",
      props: {
        style: {
          textColor: "#123456",
          fontSize: 24,
          fontWeight: "bold",
          lineHeight: 1.25,
          backgroundColor: "#ffffff",
          borderRadius: 8,
          boxShadow: "sm",
          maxWidth: 320,
        },
      },
    });
    expect(
      JSON.stringify(preview.elements.title),
    ).not.toContain("position");
  });

  it("拒绝不存在的页面", () => {
    const uiSpec = uiSpecSchema.parse({
      ...createUISpecDraft(),
      revision: 1,
    });
    expect(() =>
      toPreviewJsonSpec(uiSpec, "missing", {
        imageUrl: (path) => path,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PreviewAdapterError>>({
        code: "page_not_found",
      }),
    );
  });
});
